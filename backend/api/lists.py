"""Stores and grocery items for a household (last write wins; two people, so conflicts are rare).

Items (PK is always H#<hid>):
  STORE#<id>        a shop: name, order
  ITEM#<id>         an item: storeId, name, note, checked, addedBy (a person's name), updatedAt
  META#SEEDED       marks that the default stores were created, so deleting them all sticks
"""

import time
import uuid
from typing import Any

from botocore.exceptions import ClientError

from api.households import Session

DEFAULT_STORES = ("Costco", "Patel", "Butcher")
MAX_NAME = 80
MAX_NOTE = 120
MAX_STORES = 20
MAX_ITEMS = 500


class NotFound(Exception):
    pass


class Invalid(Exception):
    """The request was well-formed JSON but not acceptable (blank name, over a limit)."""


def _pk(session: Session) -> str:
    return f"H#{session.household_id}"


def _now() -> int:
    return time.time_ns() // 1_000_000


def _text(value: object, limit: int, *, required: bool = False) -> str:
    text = " ".join(value.split()) if isinstance(value, str) else ""
    if required and not text:
        raise Invalid("a name is required")
    return text[:limit]


def _all(table: Any, session: Session) -> list[dict[str, Any]]:
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": "PK = :pk",
        "ExpressionAttributeValues": {":pk": _pk(session)},
        "ConsistentRead": True,  # the app polls and applies its own writes, so a stale read would undo them on screen
    }
    items: list[dict[str, Any]] = []
    while True:
        page = table.query(**kwargs)
        items += page["Items"]
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def _store_view(item: dict[str, Any]) -> dict[str, Any]:
    return {"id": item["id"], "name": item["name"], "order": int(item["order"])}


def _item_view(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item["id"],
        "storeId": item["storeId"],
        "name": item["name"],
        "note": item.get("note", ""),
        "checked": bool(item["checked"]),
        "addedBy": item["addedBy"],
        "updatedAt": int(item["updatedAt"]),
    }


def _seed_defaults(table: Any, session: Session) -> None:
    try:
        table.put_item(
            Item={"PK": _pk(session), "SK": "META#SEEDED", "at": _now()}, ConditionExpression="attribute_not_exists(PK)"
        )
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return  # already seeded (or a concurrent sync did it)
        raise
    for order, name in enumerate(DEFAULT_STORES):
        store_id = uuid.uuid4().hex[:12]
        table.put_item(Item={"PK": _pk(session), "SK": f"STORE#{store_id}", "id": store_id, "name": name, "order": order})


def sync(table: Any, session: Session) -> dict[str, Any]:
    rows = _all(table, session)
    if not any(r["SK"] == "META#SEEDED" for r in rows):
        _seed_defaults(table, session)
        rows = _all(table, session)
    stores = sorted((_store_view(r) for r in rows if r["SK"].startswith("STORE#")), key=lambda s: (s["order"], s["name"]))
    items = sorted((_item_view(r) for r in rows if r["SK"].startswith("ITEM#")), key=lambda i: (i["updatedAt"], i["id"]))
    return {"stores": stores, "items": items, "now": _now()}


def _count(table: Any, session: Session, prefix: str) -> int:
    return table.query(
        KeyConditionExpression="PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues={":pk": _pk(session), ":p": prefix},
        Select="COUNT",
        ConsistentRead=True,
    )["Count"]


def _get(table: Any, session: Session, sk: str) -> dict[str, Any]:
    item = table.get_item(Key={"PK": _pk(session), "SK": sk}, ConsistentRead=True).get("Item")
    if not item:
        raise NotFound
    return item


def add_store(table: Any, session: Session, name: object) -> dict[str, Any]:
    clean = _text(name, MAX_NAME, required=True)
    if _count(table, session, "STORE#") >= MAX_STORES:
        raise Invalid(f"at most {MAX_STORES} stores")
    rows = [r for r in _all(table, session) if r["SK"].startswith("STORE#")]
    store_id = uuid.uuid4().hex[:12]
    item = {
        "PK": _pk(session),
        "SK": f"STORE#{store_id}",
        "id": store_id,
        "name": clean,
        "order": max((int(r["order"]) for r in rows), default=-1) + 1,
    }
    table.put_item(Item=item)
    return _store_view(item)


def rename_store(table: Any, session: Session, store_id: str, name: object) -> dict[str, Any]:
    item = _get(table, session, f"STORE#{store_id}")
    item["name"] = _text(name, MAX_NAME, required=True)
    table.put_item(Item=item)
    return _store_view(item)


def delete_store(table: Any, session: Session, store_id: str) -> None:
    _get(table, session, f"STORE#{store_id}")
    doomed = [r for r in _all(table, session) if r["SK"].startswith("ITEM#") and r["storeId"] == store_id]
    with table.batch_writer() as batch:
        for row in doomed:
            batch.delete_item(Key={"PK": row["PK"], "SK": row["SK"]})
        batch.delete_item(Key={"PK": _pk(session), "SK": f"STORE#{store_id}"})


def add_item(table: Any, session: Session, store_id: object, name: object, note: object, added_by: str) -> dict[str, Any]:
    clean = _text(name, MAX_NAME, required=True)
    if not isinstance(store_id, str):
        raise Invalid("storeId is required")
    _get(table, session, f"STORE#{store_id}")
    if _count(table, session, "ITEM#") >= MAX_ITEMS:
        raise Invalid(f"at most {MAX_ITEMS} items")
    item_id = uuid.uuid4().hex[:12]
    item = {
        "PK": _pk(session),
        "SK": f"ITEM#{item_id}",
        "id": item_id,
        "storeId": store_id,
        "name": clean,
        "note": _text(note, MAX_NOTE),
        "checked": False,
        "addedBy": added_by,
        "updatedAt": _now(),
    }
    table.put_item(Item=item)
    return _item_view(item)


def update_item(table: Any, session: Session, item_id: str, changes: dict[str, Any]) -> dict[str, Any]:
    item = _get(table, session, f"ITEM#{item_id}")
    if "checked" in changes:
        if not isinstance(changes["checked"], bool):
            raise Invalid("checked must be true or false")
        item["checked"] = changes["checked"]
    if "name" in changes:
        item["name"] = _text(changes["name"], MAX_NAME, required=True)
    if "note" in changes:
        item["note"] = _text(changes["note"], MAX_NOTE)
    item["updatedAt"] = _now()
    table.put_item(Item=item)
    return _item_view(item)


def delete_item(table: Any, session: Session, item_id: str) -> None:
    _get(table, session, f"ITEM#{item_id}")
    table.delete_item(Key={"PK": _pk(session), "SK": f"ITEM#{item_id}"})


def clear_checked(table: Any, session: Session, store_id: str) -> int:
    _get(table, session, f"STORE#{store_id}")
    doomed = [r for r in _all(table, session) if r["SK"].startswith("ITEM#") and r["storeId"] == store_id and r["checked"]]
    with table.batch_writer() as batch:
        for row in doomed:
            batch.delete_item(Key={"PK": row["PK"], "SK": row["SK"]})
    return len(doomed)
