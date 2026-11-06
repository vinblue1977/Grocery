"""Lambda entry point behind the function URL (payload format 2.0)."""

import json
import os
from functools import cache
from typing import Any

import boto3

from api import households, lists, scan
from api.households import Session


@cache
def get_table() -> Any:
    return boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])  # pyright: ignore[reportAttributeAccessIssue]  # untyped resource API


def _response(status: int, body: Any = None) -> dict[str, Any]:
    out: dict[str, Any] = {"statusCode": status, "headers": {"content-type": "application/json", "cache-control": "no-store"}}
    if body is not None:
        out["body"] = json.dumps(body)
    return out


def _json_body(event: dict[str, Any]) -> dict[str, Any]:
    try:
        body = json.loads(event.get("body") or "{}")
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _device_name(table: Any, session: Session) -> str:
    device = households.get_device(table, session)
    return str(device["name"]) if device else "Someone"


def _authed(table: Any, method: str, path: str, body: dict[str, Any], session: Session) -> dict[str, Any]:
    parts = path.strip("/").split("/")
    route = (method, parts[0], len(parts))
    try:
        return _route(table, method, path, parts, route, body, session)
    except lists.NotFound:
        return _response(404, {"error": "not found"})
    except lists.Busy:
        return _response(503, {"error": "busy, try again"})
    except (lists.Invalid, scan.BadImage) as err:
        return _response(400, {"error": str(err)})
    except scan.TooManyScans:
        return _response(429, {"error": f"You have used today's {scan.MAX_SCANS_PER_DAY} list scans. Try again tomorrow."})
    except scan.ScanFailed:
        return _response(502, {"error": "Could not read that photo. Try again, or add the items by hand."})


def _route(
    table: Any, method: str, path: str, parts: list[str], route: tuple[str, str, int], body: dict[str, Any], session: Session
) -> dict[str, Any]:
    if (method, path) == ("GET", "/me"):
        device = households.get_device(table, session)
        if device is None:
            return _response(401, {"error": "sign in required"})
        return _response(200, {"householdId": session.household_id, "deviceId": session.device_id, "deviceName": device["name"]})
    if (method, path) == ("POST", "/invites"):
        return _response(201, households.create_invite(table, session))
    if (method, path) == ("GET", "/devices"):
        return _response(200, {"devices": households.list_devices(table, session)})
    if route == ("DELETE", "devices", 2):
        try:
            households.revoke_device(table, session, parts[1])
        except households.NotFound:
            return _response(404, {"error": "no such device"})
        except households.LastDevice:
            return _response(409, {"error": "this is the only device; invite another before removing it"})
        return _response(204)
    if (method, path) == ("GET", "/sync"):
        return _response(200, lists.sync(table, session))
    if (method, path) == ("POST", "/stores"):
        store, created = lists.add_store(table, session, body.get("name"), body.get("id"))
        return _response(201 if created else 200, store)
    if route == ("PATCH", "stores", 2):
        return _response(200, lists.rename_store(table, session, parts[1], body.get("name")))
    if route == ("DELETE", "stores", 2):
        lists.delete_store(table, session, parts[1])
        return _response(204)
    if method == "POST" and len(parts) == 3 and parts[0] == "stores" and parts[2] == "clear":
        return _response(200, {"removed": lists.clear_checked(table, session, parts[1])})
    if (method, path) == ("POST", "/scan"):
        image = scan.decode_image(body.get("image"))  # cheap checks first: a bad photo costs no reads and no scan
        return _response(200, {"items": scan.read_list(table, session, image, lists.list_stores(table, session))})
    if (method, path) == ("PUT", "/frequent"):
        return _response(
            200, lists.set_frequent(table, session, body.get("storeId"), body.get("name"), body.get("pinned"), body.get("hidden"))
        )
    if (method, path) == ("POST", "/items/bulk"):
        return _response(201, lists.add_items(table, session, body.get("items"), _device_name(table, session)))
    if (method, path) == ("POST", "/items"):
        added_by = _device_name(table, session)
        item, created = lists.add_item(
            table, session, body.get("storeId"), body.get("name"), body.get("note"), added_by, body.get("id")
        )
        return _response(201 if created else 200, item)
    if route == ("PATCH", "items", 2):
        return _response(200, lists.update_item(table, session, parts[1], body))
    if route == ("DELETE", "items", 2):
        lists.delete_item(table, session, parts[1])
        return _response(204)
    return _response(404, {"error": "not found"})


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    http = event.get("requestContext", {}).get("http", {})
    method, path = http.get("method", ""), event.get("rawPath", "")
    if (method, path) == ("GET", "/health"):
        return _response(200, {"ok": True})
    table = get_table()
    if (method, path) == ("POST", "/household"):
        body = _json_body(event)
        try:
            return _response(201, households.create_household(table, households.clean_name(body.get("deviceName"), "Device")))
        except households.HouseholdExists:
            return _response(409, {"error": "this app already has a household: paste an invite link or code instead"})
    if (method, path) == ("POST", "/join"):
        body = _json_body(event)
        code = body.get("code")
        if not isinstance(code, str) or not code:
            return _response(400, {"error": "code is required"})
        try:
            return _response(201, households.join(table, code, households.clean_name(body.get("deviceName"), "Device")))
        except households.InvalidInvite:
            return _response(404, {"error": "invite is invalid or expired"})
    session = households.authenticate(table, (event.get("headers") or {}).get("authorization"))
    if session is None:
        return _response(401, {"error": "sign in required"})
    return _authed(table, method, path, _json_body(event), session)
