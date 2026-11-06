"""Households, invites and device tokens, all in the single DynamoDB table.

Items (PK / SK):
  APP / HOUSEHOLD            the one household this deployment allows (a guard against strangers creating more)
  H#<hid> / DEVICE#<did>     a signed-in device: name, creation time, hash of its token
  TOKEN#<sha256> / TOKEN     token lookup: which household and device a bearer token belongs to
  INVITE#<sha256> / INVITE   a single-use invite code with an expiry (`ttl`, also a DynamoDB TTL attribute)

Tokens and invite codes are 256-bit random values, so a plain SHA-256 is enough; only the hash is stored.
"""

import hashlib
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


class NotFound(Exception):
    pass


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
                "tokenHash": _hash(token),
                "createdAt": time.time_ns() // 1_000_000,  # milliseconds, so devices created together keep their order
            },
        ),
        put_op(table, {"PK": f"TOKEN#{_hash(token)}", "SK": "TOKEN", "householdId": household_id, "deviceId": device_id}),
    ]
    return ops, {"householdId": household_id, "deviceId": device_id, "token": token}


def _named(ops: list[dict[str, Any]], name: str) -> list[dict[str, Any]]:
    ops[0]["Put"]["Item"]["name"] = name
    return ops


def create_household(table: Any, device_name: str) -> dict[str, str]:
    """Claims the single household and signs in its first device in one transaction."""
    household_id = uuid.uuid4().hex
    device_ops, creds = _device_ops(table, household_id)
    claim = put_op(
        table,
        {"PK": "APP", "SK": "HOUSEHOLD", "householdId": household_id, "createdAt": int(time.time())},
        condition="attribute_not_exists(PK)",
    )
    if not transact(table, [claim, *_named(device_ops, device_name)]):
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
