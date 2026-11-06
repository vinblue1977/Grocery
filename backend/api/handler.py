"""Lambda entry point behind the function URL (payload format 2.0). Routes are added per feature."""

import json
from typing import Any


def _response(status: int, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json", "cache-control": "no-store"},
        "body": json.dumps(body),
    }


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    http = event.get("requestContext", {}).get("http", {})
    method, path = http.get("method", ""), event.get("rawPath", "")
    if method == "GET" and path == "/health":
        return _response(200, {"ok": True})
    return _response(404, {"error": "not found"})
