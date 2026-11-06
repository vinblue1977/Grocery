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

from api.households import Session, _put, _transact  # noqa: PLC2701  (shared transaction helpers)

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
    """The marker and the three stores are written in one transaction, so a crash can't leave a marker with no stores."""
    ops = [_put(table, {"PK": _pk(session), "SK": "META#SEEDED", "at": _now()}, condition="attribute_not_exists(PK)")]
    for order, name in enumerate(DEFAULT_STORES):
        store_id = uuid.uuid4().hex[:12]
        ops.append(_put(table, {"PK": _pk(session), "SK": f"STORE#{store_id}", "id": store_id, "name": name, "order": order}))
    _transact(table, ops)  # False means a concurrent sync seeded first: nothing to do


def sync(table: Any, session: Session) -> dict[str, Any]:
    rows = _all(table, session)
    if not any(r["SK"] == "META#SEEDED" for r in rows):
        _seed_defaults(table, session)
        rows = _all(table, session)
    stores = sorted((_store_view(r) for r in rows if r["SK"].startswith("STORE#")), key=lambda s: (s["order"], s["name"]))
    known = {s["id"] for s in stores}  # an item whose store was deleted at the same moment never shows up
    items = sorted(
        (_item_view(r) for r in rows if r["SK"].startswith("ITEM#") and r["storeId"] in known),
        key=lambda i: (i["updatedAt"], i["id"]),
    )
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
    rows = [r for r in _all(table, session) if r["SK"].startswith("STORE#")]
    if len(rows) >= MAX_STORES:
        raise Invalid(f"at most {MAX_STORES} stores")
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


def _update(table: Any, session: Session, sk: str, fields: dict[str, Any]) -> dict[str, Any]:
    """Sets only the given fields, and only if the row still exists, so an edit can't bring back something deleted elsewhere."""
    names = {f"#{k}": k for k in fields}
    values = {f":{k}": v for k, v in fields.items()}
    try:
        return table.update_item(
            Key={"PK": _pk(session), "SK": sk},
            UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in fields),
            ConditionExpression="attribute_exists(PK)",
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ReturnValues="ALL_NEW",
        )["Attributes"]
    except ClientError as err:
        if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise NotFound from err
        raise


def rename_store(table: Any, session: Session, store_id: str, name: object) -> dict[str, Any]:
    return _store_view(_update(table, session, f"STORE#{store_id}", {"name": _text(name, MAX_NAME, required=True)}))


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
    # The store must still exist at the moment the item is written, so a store deleted just now can't leave an orphan.
    store_exists = {
        "ConditionCheck": {
            "TableName": table.name,
            "Key": {"PK": _pk(session), "SK": f"STORE#{store_id}"},
            "ConditionExpression": "attribute_exists(PK)",
        }
    }
    if not _transact(table, [store_exists, _put(table, item)]):
        raise NotFound
    return _item_view(item)


def update_item(table: Any, session: Session, item_id: str, changes: dict[str, Any]) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    if "checked" in changes:
        if not isinstance(changes["checked"], bool):
            raise Invalid("checked must be true or false")
        fields["checked"] = changes["checked"]
    if "name" in changes:
        fields["name"] = _text(changes["name"], MAX_NAME, required=True)
    if "note" in changes:
        fields["note"] = _text(changes["note"], MAX_NOTE)
    fields["updatedAt"] = _now()
    return _item_view(_update(table, session, f"ITEM#{item_id}", fields))


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


def add_items(table: Any, session: Session, entries: object, added_by: str) -> dict[str, int]:
    """Adds many items at once (a scanned list); ones already to buy in that store are skipped, so a repeat scan is harmless."""
    if not isinstance(entries, list) or not entries:
        raise Invalid("items are required")
    rows = _all(table, session)
    stores = {r["id"] for r in rows if r["SK"].startswith("STORE#")}
    existing = {(r["storeId"], r["name"].lower()) for r in rows if r["SK"].startswith("ITEM#") and not r["checked"]}
    total = sum(1 for r in rows if r["SK"].startswith("ITEM#"))
    fresh: list[dict[str, Any]] = []
    skipped = 0
    for entry in entries[:50]:
        if not isinstance(entry, dict):
            raise Invalid("each item must be an object")
        name = _text(entry.get("name"), MAX_NAME, required=True)
        store_id = entry.get("storeId")
        if store_id not in stores:
            raise Invalid("storeId is not one of your stores")
        key = (store_id, name.lower())
        if key in existing:
            skipped += 1
            continue
        existing.add(key)
        item_id = uuid.uuid4().hex[:12]
        fresh.append(
            {
                "PK": _pk(session),
                "SK": f"ITEM#{item_id}",
                "id": item_id,
                "storeId": store_id,
                "name": name,
                "note": _text(entry.get("note"), MAX_NOTE),
                "checked": False,
                "addedBy": added_by,
                "updatedAt": _now(),
            }
        )
    if total + len(fresh) > MAX_ITEMS:
        raise Invalid(f"at most {MAX_ITEMS} items")
    with table.batch_writer() as batch:
        for item in fresh:
            batch.put_item(Item=item)
    return {"added": len(fresh), "skipped": skipped}
