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


@dataclass(frozen=True)
class Session:
    household_id: str
    device_id: str


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def clean_name(value: object, fallback: str) -> str:
    name = value.strip() if isinstance(value, str) else ""
    return name[:MAX_NAME_LENGTH] or fallback


def _add_device(table: Any, household_id: str, device_name: str) -> dict[str, str]:
    device_id = uuid.uuid4().hex
    token = secrets.token_urlsafe(32)
    table.put_item(
        Item={
            "PK": f"H#{household_id}",
            "SK": f"DEVICE#{device_id}",
            "deviceId": device_id,
            "name": device_name,
            "tokenHash": _hash(token),
            "createdAt": time.time_ns() // 1_000_000,  # milliseconds, so devices created together keep their order
        }
    )
    table.put_item(Item={"PK": f"TOKEN#{_hash(token)}", "SK": "TOKEN", "householdId": household_id, "deviceId": device_id})
    return {"householdId": household_id, "deviceId": device_id, "token": token}


def create_household(table: Any, device_name: str) -> dict[str, str]:
    household_id = uuid.uuid4().hex
    try:
        table.put_item(
            Item={"PK": "APP", "SK": "HOUSEHOLD", "householdId": household_id, "createdAt": int(time.time())},
            ConditionExpression="attribute_not_exists(PK)",
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise HouseholdExists from err
        raise
    return _add_device(table, household_id, device_name)


def create_invite(table: Any, session: Session, now: float | None = None) -> dict[str, Any]:
    code = secrets.token_urlsafe(24)
    expires = int((now if now is not None else time.time()) + INVITE_LIFETIME_SECONDS)
    table.put_item(Item={"PK": f"INVITE#{_hash(code)}", "SK": "INVITE", "householdId": session.household_id, "ttl": expires})
    return {"code": code, "expiresAt": expires}


def join(table: Any, code: str, device_name: str, now: float | None = None) -> dict[str, str]:
    """Spends the invite atomically: a conditional delete lets only one caller win."""
    try:
        old = table.delete_item(
            Key={"PK": f"INVITE#{_hash(code)}", "SK": "INVITE"},
            ConditionExpression="attribute_exists(PK)",
            ReturnValues="ALL_OLD",
        ).get("Attributes")
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise InvalidInvite from err
        raise
    # DynamoDB's TTL sweep can lag by up to two days, so expiry is checked here too.
    if not old or int(old["ttl"]) < (now if now is not None else time.time()):
        raise InvalidInvite
    return _add_device(table, old["householdId"], device_name)


def authenticate(table: Any, authorization: str | None) -> Session | None:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    item = table.get_item(Key={"PK": f"TOKEN#{_hash(token)}", "SK": "TOKEN"}).get("Item")
    return Session(item["householdId"], item["deviceId"]) if item else None


def list_devices(table: Any, session: Session) -> list[dict[str, Any]]:
    items = table.query(
        KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues={":pk": f"H#{session.household_id}", ":sk": "DEVICE#"},
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
    device = table.get_item(Key=key).get("Item")
    if not device:
        raise NotFound
    # The token item is what grants access, so it goes first.
    table.delete_item(Key={"PK": f"TOKEN#{device['tokenHash']}", "SK": "TOKEN"})
    table.delete_item(Key=key)
