"""Stores and grocery items for a household (last write wins; two people, so conflicts are rare).

Items (PK is always H#<hid>):
  STORE#<id>        a shop: name, order
  ITEM#<id>         an item: storeId, name, note, checked, addedBy (a person's name), updatedAt
  FREQ#<storeId>#<name>  how often a name was added to a store (count), and whether it is pinned or hidden from suggestions
  META#SEEDED       marks that the default stores were created, so deleting them all sticks
"""

import logging
import re
import time
import uuid
from typing import Any

from botocore.exceptions import ClientError

from api.households import Session, put_op, transact

DEFAULT_STORES = ("Costco", "Patel", "Butcher")
logger = logging.getLogger(__name__)

MAX_NAME = 80
MAX_NOTE = 120
MAX_STORES = 20
MAX_ITEMS = 500
FREQ_MIN = 3  # an item added this many times to a store is suggested there
ID_PATTERN = re.compile(r"[0-9a-f]{12,32}")  # a client-made id (the server makes 12-hex ones), so an offline edit replays safely
MAX_FREQ = 150  # remembered names per household; keeps the sync read small (the table is 25 RCU)


class NotFound(Exception):
    pass


class Busy(Exception):
    """A write collided with another one in flight; nothing was saved, and trying again will work."""


class Invalid(Exception):
    """The request was well-formed JSON but not acceptable (blank name, over a limit)."""


def household_key(session: Session) -> str:
    return f"H#{session.household_id}"


def _now() -> int:
    return time.time_ns() // 1_000_000


def _new_id(value: object) -> str:
    """The id a client chose for a new store or item (so a replay is recognised), or a fresh one."""
    if value is None:
        return uuid.uuid4().hex[:12]
    if not isinstance(value, str) or not ID_PATTERN.fullmatch(value):
        raise Invalid("id must be 12 to 32 lowercase hex characters")
    return value


def clean_text(value: object, limit: int, *, required: bool = False) -> str:
    text = " ".join(value.split()) if isinstance(value, str) else ""
    if required and not text:
        raise Invalid("a name is required")
    return text[:limit]


def _all(table: Any, session: Session) -> list[dict[str, Any]]:
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": "PK = :pk",
        "ExpressionAttributeValues": {":pk": household_key(session)},
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
    ops = [put_op(table, {"PK": household_key(session), "SK": "META#SEEDED", "at": _now()}, condition="attribute_not_exists(PK)")]
    for order, name in enumerate(DEFAULT_STORES):
        store_id = uuid.uuid4().hex[:12]
        ops.append(
            put_op(table, {"PK": household_key(session), "SK": f"STORE#{store_id}", "id": store_id, "name": name, "order": order})
        )
    transact(table, ops)  # False means a concurrent sync seeded first: nothing to do


def _frequent_views(table: Any, rows: list[dict[str, Any]], known: set[str]) -> list[dict[str, Any]]:
    """Suggestions to show: pinned or added often enough, not hidden, in a store that still exists. Also trims the history."""
    freq = [r for r in rows if r["SK"].startswith("FREQ#")]
    # Forget history for stores that are gone (a delete can race an add), then, if still over the cap, the least-used names.
    # Pinned and hidden names are the person's own choices, so they are never evicted.
    doomed = [r for r in freq if r["storeId"] not in known]
    keep = [r for r in freq if r["storeId"] in known]
    if len(keep) > MAX_FREQ:
        extras = sorted(
            (r for r in keep if not r.get("pinned") and not r.get("hidden")), key=lambda r: (int(r["count"]), int(r["updatedAt"]))
        )
        doomed += extras[: len(keep) - MAX_FREQ]
    if doomed:
        with table.batch_writer() as batch:
            for row in doomed:
                batch.delete_item(Key={"PK": row["PK"], "SK": row["SK"]})
        gone = {r["SK"] for r in doomed}
        freq = [r for r in freq if r["SK"] not in gone]
    shown = [
        r for r in freq if r["storeId"] in known and not r.get("hidden") and (r.get("pinned") or int(r["count"]) >= FREQ_MIN)
    ]
    shown.sort(key=lambda r: (not r.get("pinned"), -int(r["count"]), r["name"].casefold()))
    return [
        {"storeId": r["storeId"], "name": r["name"], "count": int(r["count"]), "pinned": bool(r.get("pinned"))} for r in shown
    ]


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
    return {"stores": stores, "items": items, "frequent": _frequent_views(table, rows, known), "now": _now()}


def _count(table: Any, session: Session, prefix: str) -> int:
    return table.query(
        KeyConditionExpression="PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues={":pk": household_key(session), ":p": prefix},
        Select="COUNT",
        ConsistentRead=True,
    )["Count"]


def _get(table: Any, session: Session, sk: str) -> dict[str, Any]:
    item = table.get_item(Key={"PK": household_key(session), "SK": sk}, ConsistentRead=True).get("Item")
    if not item:
        raise NotFound
    return item


def list_stores(table: Any, session: Session) -> list[dict[str, Any]]:
    """Just the stores (one small query), for callers that don't need items."""
    rows = table.query(
        KeyConditionExpression="PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues={":pk": household_key(session), ":p": "STORE#"},
        ConsistentRead=True,
    )["Items"]
    return sorted((_store_view(r) for r in rows), key=lambda s: (s["order"], s["name"]))


def add_store(table: Any, session: Session, name: object, store_id: object = None) -> tuple[dict[str, Any], bool]:
    """Returns the store and whether it was created now (False: this id was already added, so a replay changes nothing)."""
    clean = clean_text(name, MAX_NAME, required=True)
    new_id = _new_id(store_id)
    if store_id is not None:  # a server-made id can't be a replay, so only a client-chosen one needs the lookup
        existing = table.get_item(Key={"PK": household_key(session), "SK": f"STORE#{new_id}"}, ConsistentRead=True).get("Item")
        if existing:
            if existing["name"] != clean:
                raise Invalid("that id already belongs to a different store")
            return _store_view(existing), False
    rows = [r for r in _all(table, session) if r["SK"].startswith("STORE#")]
    if len(rows) >= MAX_STORES:
        raise Invalid(f"at most {MAX_STORES} stores")
    item = {
        "PK": household_key(session),
        "SK": f"STORE#{new_id}",
        "id": new_id,
        "name": clean,
        "order": max((int(r["order"]) for r in rows), default=-1) + 1,
    }
    try:
        table.put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        raced = _get(table, session, f"STORE#{new_id}")  # a concurrent replay won the race
        if raced["name"] != clean:
            raise Invalid("that id already belongs to a different store") from err
        return _store_view(raced), False
    return _store_view(item), True


def _update(table: Any, session: Session, sk: str, fields: dict[str, Any]) -> dict[str, Any]:
    """Sets only the given fields, and only if the row still exists, so an edit can't bring back something deleted elsewhere."""
    names = {f"#{k}": k for k in fields}
    values = {f":{k}": v for k, v in fields.items()}
    try:
        return table.update_item(
            Key={"PK": household_key(session), "SK": sk},
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
    return _store_view(_update(table, session, f"STORE#{store_id}", {"name": clean_text(name, MAX_NAME, required=True)}))


def delete_store(table: Any, session: Session, store_id: str) -> None:
    _get(table, session, f"STORE#{store_id}")
    doomed = [r for r in _all(table, session) if r["SK"].startswith(("ITEM#", "FREQ#")) and r["storeId"] == store_id]
    with table.batch_writer() as batch:
        for row in doomed:
            batch.delete_item(Key={"PK": row["PK"], "SK": row["SK"]})
        batch.delete_item(Key={"PK": household_key(session), "SK": f"STORE#{store_id}"})


def _freq_key(session: Session, store_id: str, name: str) -> dict[str, str]:
    return {"PK": household_key(session), "SK": f"FREQ#{store_id}#{name.lower()}"}


def _bump(table: Any, session: Session, store_id: str, name: str) -> None:
    """Counts one more add of this name in this store. Best effort: the item is already saved, so a failure is not an error."""
    try:
        table.update_item(
            Key=_freq_key(session, store_id, name),
            UpdateExpression=(
                "ADD #c :one SET #n = :n, storeId = :s, updatedAt = :t, "
                "#pinned = if_not_exists(#pinned, :no), #hidden = if_not_exists(#hidden, :no)"
            ),
            ExpressionAttributeNames={"#c": "count", "#n": "name", "#pinned": "pinned", "#hidden": "hidden"},
            ExpressionAttributeValues={":one": 1, ":n": name, ":s": store_id, ":t": _now(), ":no": False},
        )
    except ClientError:
        logger.exception("could not count a frequent item")


def set_frequent(table: Any, session: Session, store_id: object, name: object, pinned: object, hidden: object) -> dict[str, Any]:
    """Pins a suggestion (keeps it shown) or hides it. Pinning un-hides, and hiding un-pins."""
    clean = clean_text(name, MAX_NAME, required=True)
    if not isinstance(store_id, str):
        raise Invalid("storeId is required")
    if pinned is not None and not isinstance(pinned, bool) or hidden is not None and not isinstance(hidden, bool):
        raise Invalid("pinned and hidden must be true or false")
    if pinned is None and hidden is None:
        raise Invalid("pinned or hidden is required")
    if pinned:
        hidden = False
    elif hidden:
        pinned = False
    _get(table, session, f"STORE#{store_id}")
    fields: dict[str, Any] = {"name": clean, "storeId": store_id, "updatedAt": _now()}
    if pinned is not None:
        fields["pinned"] = pinned
    if hidden is not None:
        fields["hidden"] = hidden
    names = {f"#{k}": k for k in fields} | {"#c": "count"}
    values = {f":{k}": v for k, v in fields.items()} | {":zero": 0}
    sets = [f"#{k} = :{k}" for k in fields] + ["#c = if_not_exists(#c, :zero)"]
    for k in ("pinned", "hidden"):
        if k not in fields:  # the one not being set starts out false on a brand-new row
            sets.append(f"#{k} = if_not_exists(#{k}, :no)")
            names[f"#{k}"] = k
            values[":no"] = False
    row = table.update_item(
        Key=_freq_key(session, store_id, clean),
        UpdateExpression="SET " + ", ".join(sets),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ReturnValues="ALL_NEW",
    )["Attributes"]
    return {
        "storeId": store_id,
        "name": row["name"],
        "count": int(row["count"]),
        "pinned": bool(row["pinned"]),
        "hidden": bool(row["hidden"]),
    }


def _replayed(existing: dict[str, Any], store_id: str, name: str) -> dict[str, Any]:
    """The item an earlier request with this id created, unless the id is really being reused for a different item."""
    if existing["storeId"] != store_id or existing["name"].casefold() != name.casefold():
        raise Invalid("that id already belongs to a different item")
    return _item_view(existing)


def add_item(
    table: Any, session: Session, store_id: object, name: object, note: object, added_by: str, item_id: object = None
) -> tuple[dict[str, Any], bool]:
    """Returns the item and whether it was created now (False: this id was already added, so a replay changes nothing)."""
    clean = clean_text(name, MAX_NAME, required=True)
    if not isinstance(store_id, str):
        raise Invalid("storeId is required")
    new_id = _new_id(item_id)
    if item_id is not None:  # a server-made id can't be a replay, so only a client-chosen one needs the lookup
        existing = table.get_item(Key={"PK": household_key(session), "SK": f"ITEM#{new_id}"}, ConsistentRead=True).get("Item")
        if existing:
            return _replayed(existing, store_id, clean), False
    if _count(table, session, "ITEM#") >= MAX_ITEMS:
        raise Invalid(f"at most {MAX_ITEMS} items")
    item = {
        "PK": household_key(session),
        "SK": f"ITEM#{new_id}",
        "id": new_id,
        "storeId": store_id,
        "name": clean,
        "note": clean_text(note, MAX_NOTE),
        "checked": False,
        "addedBy": added_by,
        "updatedAt": _now(),
    }
    # The store must still exist at the moment the item is written, so a store deleted just now can't leave an orphan.
    store_exists = {
        "ConditionCheck": {
            "TableName": table.name,
            "Key": {"PK": household_key(session), "SK": f"STORE#{store_id}"},
            "ConditionExpression": "attribute_exists(PK)",
        }
    }
    if not transact(table, [store_exists, put_op(table, item, condition="attribute_not_exists(PK)")]):
        raced = table.get_item(Key={"PK": household_key(session), "SK": f"ITEM#{new_id}"}, ConsistentRead=True).get("Item")
        if raced:  # a concurrent replay of the same add won the race
            return _replayed(raced, store_id, clean), False
        store = table.get_item(Key={"PK": household_key(session), "SK": f"STORE#{store_id}"}, ConsistentRead=True).get("Item")
        if not store:
            raise NotFound
        raise Busy  # the store is there, so the transaction lost to a concurrent write: nothing saved, safe to retry
    _bump(table, session, store_id, clean)
    return _item_view(item), True


def update_item(table: Any, session: Session, item_id: str, changes: dict[str, Any]) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    if "checked" in changes:
        if not isinstance(changes["checked"], bool):
            raise Invalid("checked must be true or false")
        fields["checked"] = changes["checked"]
    if "name" in changes:
        fields["name"] = clean_text(changes["name"], MAX_NAME, required=True)
    if "note" in changes:
        fields["note"] = clean_text(changes["note"], MAX_NOTE)
    fields["updatedAt"] = _now()
    return _item_view(_update(table, session, f"ITEM#{item_id}", fields))


def delete_item(table: Any, session: Session, item_id: str) -> None:
    _get(table, session, f"ITEM#{item_id}")
    table.delete_item(Key={"PK": household_key(session), "SK": f"ITEM#{item_id}"})


def clear_checked(table: Any, session: Session, store_id: str) -> int:
    _get(table, session, f"STORE#{store_id}")
    doomed = [r for r in _all(table, session) if r["SK"].startswith("ITEM#") and r["storeId"] == store_id and r["checked"]]
    with table.batch_writer() as batch:
        for row in doomed:
            batch.delete_item(Key={"PK": row["PK"], "SK": row["SK"]})
    return len(doomed)


MAX_BULK = 50


def add_items(table: Any, session: Session, entries: object, added_by: str) -> dict[str, int]:
    """Adds many items at once (a scanned list); ones already to buy in that store are skipped, so a repeat scan is harmless."""
    if not isinstance(entries, list) or not entries:
        raise Invalid("items are required")
    if len(entries) > MAX_BULK:
        raise Invalid(f"at most {MAX_BULK} items at a time")
    rows = _all(table, session)
    stores = {r["id"] for r in rows if r["SK"].startswith("STORE#")}
    existing = {(r["storeId"], r["name"].lower()) for r in rows if r["SK"].startswith("ITEM#") and not r["checked"]}
    total = sum(1 for r in rows if r["SK"].startswith("ITEM#"))
    fresh: list[dict[str, Any]] = []
    skipped = 0
    for entry in entries:
        if not isinstance(entry, dict):
            raise Invalid("each item must be an object")
        name = clean_text(entry.get("name"), MAX_NAME, required=True)
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
                "PK": household_key(session),
                "SK": f"ITEM#{item_id}",
                "id": item_id,
                "storeId": store_id,
                "name": name,
                "note": clean_text(entry.get("note"), MAX_NOTE),
                "checked": False,
                "addedBy": added_by,
                "updatedAt": _now(),
            }
        )
    if total + len(fresh) > MAX_ITEMS:
        raise Invalid(f"at most {MAX_ITEMS} items")
    if fresh:
        # Each store must still exist when the items are written (as add_item does), so a deleted store leaves no orphans.
        checks = [
            {
                "ConditionCheck": {
                    "TableName": table.name,
                    "Key": {"PK": household_key(session), "SK": f"STORE#{sid}"},
                    "ConditionExpression": "attribute_exists(PK)",
                }
            }
            for sid in sorted({f["storeId"] for f in fresh})
        ]
        if not transact(table, [*checks, *(put_op(table, f) for f in fresh)]):
            raise NotFound
        for f in fresh:
            _bump(table, session, f["storeId"], f["name"])
    return {"added": len(fresh), "skipped": skipped}
