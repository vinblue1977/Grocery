"""Households, invites and device tokens, all in the single DynamoDB table.

Items (PK / SK):
  APP / HOUSEHOLD            the one household this deployment allows (a guard against strangers creating more)
  H#<hid> / DEVICE#<did>     a signed-in device: name, creation time, hash of its token
  TOKEN#<sha256> / TOKEN     token lookup: which household and device a bearer token belongs to
  INVITE#<sha256> / INVITE   a single-use invite code with an expiry (`ttl`, also a DynamoDB TTL attribute)
  H#<hid> / META#RECOVERY    hash of the household's recovery code

Tokens and invite codes are 256-bit random values, so a plain SHA-256 is enough; only the hash is stored.
"""

import hashlib
import hmac
import secrets
import time
import uuid
from dataclasses import dataclass
from typing import Any

from botocore.exceptions import ClientError

INVITE_LIFETIME_SECONDS = 24 * 3600
MAX_NAME_LENGTH = 40


class HouseholdExists(Exception):
    """This deployment already has its household."""


class InvalidInvite(Exception):
    """The invite code is unknown, used or expired."""


class InvalidRecovery(Exception):
    """The recovery code is unknown, blank or malformed."""


class NotFound(Exception):
    pass


class InvalidName(Exception):
    """A rename was sent with no usable name."""


class LastDevice(Exception):
    """Removing the only device would leave nobody able to sign in or invite."""


@dataclass(frozen=True)
class Session:
    household_id: str
    device_id: str


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def clean_name(value: object, fallback: str) -> str:
    name = value.strip() if isinstance(value, str) else ""
    return name[:MAX_NAME_LENGTH] or fallback


def put_op(table: Any, item: dict[str, Any], condition: str | None = None) -> dict[str, Any]:
    # The resource client converts plain Python values to DynamoDB types, including inside transactions.
    op: dict[str, Any] = {"TableName": table.name, "Item": item}
    if condition:
        op["ConditionExpression"] = condition
    return {"Put": op}


def transact(table: Any, ops: list[dict[str, Any]]) -> bool:
    """All-or-nothing write. Returns False when a condition failed, so callers can map that to their own error."""
    try:
        table.meta.client.transact_write_items(TransactItems=ops)
    except ClientError as err:
        if err.response["Error"]["Code"] == "TransactionCanceledException":
            return False
        raise
    return True


def _device_ops(table: Any, household_id: str) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """The two writes that make a signed-in device: its record, and the token lookup that grants access."""
    device_id = uuid.uuid4().hex
    token = secrets.token_urlsafe(32)
    ops = [
        put_op(
            table,
            {
                "PK": f"H#{household_id}",
                "SK": f"DEVICE#{device_id}",
                "deviceId": device_id,
                "name": "",
                "person": "",  # who uses this device; empty until they pick (devices made before this have no attribute)
                "tokenHash": _hash(token),
                "createdAt": time.time_ns() // 1_000_000,  # milliseconds, so devices created together keep their order
            },
        ),
        put_op(table, {"PK": f"TOKEN#{_hash(token)}", "SK": "TOKEN", "householdId": household_id, "deviceId": device_id}),
    ]
    return ops, {"householdId": household_id, "deviceId": device_id, "token": token}


def _named(ops: list[dict[str, Any]], name: str, person: str = "") -> list[dict[str, Any]]:
    ops[0]["Put"]["Item"]["name"] = name
    ops[0]["Put"]["Item"]["person"] = person
    return ops


def person_of(device: dict[str, Any]) -> str:
    """The person a device belongs to. Devices made before people existed used their name for that, so they still do."""
    return str(device["person"]) if "person" in device else str(device["name"])


def create_household(table: Any, device_name: str, person: str = "") -> dict[str, str]:
    """Claims the single household and signs in its first device in one transaction."""
    household_id = uuid.uuid4().hex
    device_ops, creds = _device_ops(table, household_id)
    claim = put_op(
        table,
        {"PK": "APP", "SK": "HOUSEHOLD", "householdId": household_id, "createdAt": int(time.time())},
        condition="attribute_not_exists(PK)",
    )
    if not transact(table, [claim, *_named(device_ops, device_name, person)]):
        raise HouseholdExists
    return creds


def create_invite(table: Any, session: Session, now: float | None = None) -> dict[str, Any]:
    code = secrets.token_urlsafe(24)
    expires = int((now if now is not None else time.time()) + INVITE_LIFETIME_SECONDS)
    table.put_item(Item={"PK": f"INVITE#{_hash(code)}", "SK": "INVITE", "householdId": session.household_id, "ttl": expires})
    return {"code": code, "expiresAt": expires}


def join(table: Any, code: str, device_name: str, now: float | None = None) -> dict[str, str]:
    """Spends the invite and signs in the new device in one transaction: both happen or neither does."""
    when = int(now if now is not None else time.time())
    key = {"PK": f"INVITE#{_hash(code)}", "SK": "INVITE"}
    invite = table.get_item(Key=key, ConsistentRead=True).get("Item")
    # DynamoDB's TTL sweep can lag by up to two days, so expiry is enforced here and again inside the transaction.
    if not invite or int(invite["ttl"]) < when:
        raise InvalidInvite
    device_ops, creds = _device_ops(table, invite["householdId"])
    spend = {
        "Delete": {
            "TableName": table.name,
            "Key": key,
            "ConditionExpression": "attribute_exists(PK) AND #t >= :now",
            "ExpressionAttributeNames": {"#t": "ttl"},
            "ExpressionAttributeValues": {":now": when},
        }
    }
    if not transact(table, [spend, *_named(device_ops, device_name)]):
        raise InvalidInvite  # someone else spent it first
    return creds


def authenticate(table: Any, authorization: str | None) -> Session | None:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    # Consistent read: a device that just signed in must be recognised at once, or the app would sign itself out.
    item = table.get_item(Key={"PK": f"TOKEN#{_hash(token)}", "SK": "TOKEN"}, ConsistentRead=True).get("Item")
    return Session(item["householdId"], item["deviceId"]) if item else None


def get_device(table: Any, session: Session) -> dict[str, Any] | None:
    key = {"PK": f"H#{session.household_id}", "SK": f"DEVICE#{session.device_id}"}
    return table.get_item(Key=key, ConsistentRead=True).get("Item")


def list_devices(table: Any, session: Session) -> list[dict[str, Any]]:
    items = table.query(
        KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues={":pk": f"H#{session.household_id}", ":sk": "DEVICE#"},
        ConsistentRead=True,
    )["Items"]
    devices = [
        {
            "deviceId": i["deviceId"],
            "name": i["name"],
            "person": person_of(i),
            "createdAt": int(i["createdAt"]),
            "current": i["deviceId"] == session.device_id,
        }
        for i in items
    ]
    return sorted(devices, key=lambda d: d["createdAt"])


def revoke_device(table: Any, session: Session, device_id: str) -> None:
    key = {"PK": f"H#{session.household_id}", "SK": f"DEVICE#{device_id}"}
    device = table.get_item(Key=key, ConsistentRead=True).get("Item")
    if not device:
        raise NotFound
    if len(list_devices(table, session)) <= 1:
        raise LastDevice
    # The token item is what grants access, so it goes first.
    table.delete_item(Key={"PK": f"TOKEN#{device['tokenHash']}", "SK": "TOKEN"})
    table.delete_item(Key=key)


def _recovery_key(household_id: str) -> dict[str, str]:
    return {"PK": f"H#{household_id}", "SK": "META#RECOVERY"}


def create_recovery(table: Any, session: Session, now: float | None = None) -> dict[str, str]:
    """Makes a new recovery code, replacing any older one. Only its hash is stored; the code is returned once."""
    code = "rec_" + secrets.token_urlsafe(20)
    created = int(now if now is not None else time.time())
    table.put_item(Item={**_recovery_key(session.household_id), "codeHash": _hash(code), "createdAt": created})
    return {"code": code}


def recover(table: Any, code: object, device_name: str) -> dict[str, str]:
    """Signs in a new device with the household's recovery code. The code stays valid; a new one replaces it.

    There is no guess limiter on purpose: the code has about 160 bits of entropy, so guessing is infeasible (tokens are
    protected the same way), and a household-wide lockout would let an anonymous caller lock the owner out of recovery.
    """
    household = table.get_item(Key={"PK": "APP", "SK": "HOUSEHOLD"}, ConsistentRead=True).get("Item")
    household_id = str(household["householdId"]) if household else ""
    row = table.get_item(Key=_recovery_key(household_id), ConsistentRead=True).get("Item") if household else None
    text = code if isinstance(code, str) and len(code) <= 200 else ""
    expected = str(row["codeHash"]) if row else "0" * 64
    matches = hmac.compare_digest(_hash(text), expected)  # always hashes and compares, so every failure costs the same
    if not (row and text and matches):
        raise InvalidRecovery
    device_ops, creds = _device_ops(table, household_id)
    # The code may have been replaced since we read it: the write only goes through if the verified hash is still current.
    still_current = {
        "ConditionCheck": {
            "TableName": table.name,
            "Key": _recovery_key(household_id),
            "ConditionExpression": "#h = :hash",
            "ExpressionAttributeNames": {"#h": "codeHash"},
            "ExpressionAttributeValues": {":hash": expected},
        }
    }
    if not transact(table, [still_current, *_named(device_ops, device_name)]):
        raise InvalidRecovery
    return creds


def rename_device(table: Any, session: Session, device_id: str, name: object) -> dict[str, str]:
    """A device may only rename itself. The condition stops the update from recreating a device removed meanwhile."""
    if device_id != session.device_id:
        raise NotFound
    clean = clean_name(name, "")
    if not clean:
        raise InvalidName  # unlike sign-in, a rename never falls back to a placeholder: it would erase the current name
    try:
        table.update_item(
            Key={"PK": f"H#{session.household_id}", "SK": f"DEVICE#{device_id}"},
            # if_not_exists reads the old name: a device from before people existed keeps it as its person.
            UpdateExpression="SET #n = :n, person = if_not_exists(person, #n)",
            ConditionExpression="attribute_exists(PK)",
            ExpressionAttributeNames={"#n": "name"},
            ExpressionAttributeValues={":n": clean},
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise NotFound from err
        raise
    return {"deviceId": device_id, "name": clean}


def list_people(table: Any, session: Session) -> list[str]:
    """The distinct people on the household's devices, in the order they first appeared."""
    people: list[str] = []
    for device in list_devices(table, session):
        if device["person"] and device["person"].lower() not in {p.lower() for p in people}:
            people.append(device["person"])
    return people


def set_person(table: Any, session: Session, name: object) -> dict[str, str]:
    """A device says who uses it. The condition stops the update from recreating a device removed meanwhile."""
    clean = clean_name(name, "")
    if not clean:
        raise InvalidName
    try:
        table.update_item(
            Key={"PK": f"H#{session.household_id}", "SK": f"DEVICE#{session.device_id}"},
            UpdateExpression="SET person = :p",
            ConditionExpression="attribute_exists(PK)",
            ExpressionAttributeValues={":p": clean},
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise NotFound from err
        raise
    return {"person": clean}
