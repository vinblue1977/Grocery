"""Lambda entry point behind the function URL (payload format 2.0)."""

import json
import os
from functools import cache
from typing import Any

import boto3

from api import households
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


def _authed(event: dict[str, Any], method: str, path: str, session: Session) -> dict[str, Any]:
    table = get_table()
    if (method, path) == ("GET", "/me"):
        device = next(d for d in households.list_devices(table, session) if d["current"])
        return _response(200, {"householdId": session.household_id, "deviceId": session.device_id, "deviceName": device["name"]})
    if (method, path) == ("POST", "/invites"):
        return _response(201, households.create_invite(table, session))
    if (method, path) == ("GET", "/devices"):
        return _response(200, {"devices": households.list_devices(table, session)})
    if method == "DELETE" and path.startswith("/devices/"):
        try:
            households.revoke_device(table, session, path.removeprefix("/devices/"))
        except households.NotFound:
            return _response(404, {"error": "no such device"})
        return _response(204)
    return _response(404, {"error": "not found"})


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    http = event.get("requestContext", {}).get("http", {})
    method, path = http.get("method", ""), event.get("rawPath", "")
    table = get_table()
    if (method, path) == ("GET", "/health"):
        return _response(200, {"ok": True})
    if (method, path) == ("POST", "/household"):
        body = _json_body(event)
        try:
            return _response(201, households.create_household(table, households.clean_name(body.get("deviceName"), "Device")))
        except households.HouseholdExists:
            return _response(409, {"error": "this app already has a household; ask for an invite"})
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
    return _authed(event, method, path, session)
