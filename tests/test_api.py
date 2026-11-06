import json

from api.handler import handler


def _event(method: str, path: str) -> dict:
    return {"rawPath": path, "requestContext": {"http": {"method": method}}}


def test_health_is_ok():
    res = handler(_event("GET", "/health"), None)
    assert res["statusCode"] == 200
    assert json.loads(res["body"]) == {"ok": True}


def test_unknown_route_is_404():
    assert handler(_event("GET", "/nope"), None)["statusCode"] == 404


def test_empty_event_is_404():
    assert handler({}, None)["statusCode"] == 404
