import json

from api.handler import handler


def call(method: str, path: str, body: dict | str | None = None, token: str | None = None) -> tuple[int, dict]:
    event = {
        "rawPath": path,
        "requestContext": {"http": {"method": method}},
        "headers": {"authorization": f"Bearer {token}"} if token else {},
    }
    if body is not None:
        event["body"] = body if isinstance(body, str) else json.dumps(body)
    res = handler(event, None)
    return res["statusCode"], json.loads(res.get("body") or "{}")


def create(name: str = "Vinod's iPhone") -> dict:
    status, body = call("POST", "/household", {"deviceName": name})
    assert status == 201
    return body


def test_health_needs_no_sign_in(table):
    assert call("GET", "/health") == (200, {"ok": True})


def test_create_household_returns_a_working_token(table):
    me = create()
    status, body = call("GET", "/me", token=me["token"])
    assert status == 200
    assert body == {"householdId": me["householdId"], "deviceId": me["deviceId"], "deviceName": "Vinod's iPhone"}


def test_only_one_household_can_exist(table):
    create()
    status, _ = call("POST", "/household", {"deviceName": "Stranger"})
    assert status == 409


def test_blank_or_missing_device_name_gets_a_default_and_long_names_are_cut(table):
    status, body = call("POST", "/household", "not json")
    assert status == 201
    assert call("GET", "/me", token=body["token"])[1]["deviceName"] == "Device"


def test_long_device_name_is_truncated(table):
    me = create("x" * 100)
    assert len(call("GET", "/me", token=me["token"])[1]["deviceName"]) == 40


def test_invite_lets_a_second_device_join_and_works_once(table):
    me = create()
    status, invite = call("POST", "/invites", token=me["token"])
    assert status == 201
    status, joined = call("POST", "/join", {"code": invite["code"], "deviceName": "Yaso's iPhone"})
    assert status == 201
    assert joined["householdId"] == me["householdId"]
    assert call("GET", "/me", token=joined["token"])[0] == 200
    assert call("POST", "/join", {"code": invite["code"], "deviceName": "Another"})[0] == 404


def test_expired_invite_is_rejected(table):
    from api import households
    from api.households import Session

    me = create()
    invite = households.create_invite(table, Session(me["householdId"], me["deviceId"]), now=0)
    assert call("POST", "/join", {"code": invite["code"]})[0] == 404


def test_join_validates_the_code(table):
    assert call("POST", "/join", {})[0] == 400
    assert call("POST", "/join", {"code": 5})[0] == 400
    assert call("POST", "/join", {"code": "nope"})[0] == 404


def test_requests_without_a_valid_token_are_refused(table):
    create()
    assert call("GET", "/me")[0] == 401
    assert call("GET", "/me", token="wrong")[0] == 401
    assert call("GET", "/devices", token="wrong")[0] == 401
    status, _ = call("GET", "/me", token=None)
    assert status == 401
    event = {"rawPath": "/me", "requestContext": {"http": {"method": "GET"}}, "headers": {"authorization": "Basic abc"}}
    assert handler(event, None)["statusCode"] == 401
    assert handler({"rawPath": "/me", "requestContext": {"http": {"method": "GET"}}}, None)["statusCode"] == 401


def test_devices_list_marks_the_current_one(table):
    me = create()
    invite = call("POST", "/invites", token=me["token"])[1]
    joined = call("POST", "/join", {"code": invite["code"], "deviceName": "Yaso's iPhone"})[1]
    devices = call("GET", "/devices", token=joined["token"])[1]["devices"]
    assert [d["name"] for d in devices] == ["Vinod's iPhone", "Yaso's iPhone"]
    assert [d["current"] for d in devices] == [False, True]


def test_revoking_a_device_signs_it_out(table):
    me = create()
    invite = call("POST", "/invites", token=me["token"])[1]
    joined = call("POST", "/join", {"code": invite["code"], "deviceName": "Yaso's iPhone"})[1]
    assert call("DELETE", f"/devices/{joined['deviceId']}", token=me["token"])[0] == 204
    assert call("GET", "/me", token=joined["token"])[0] == 401
    assert call("GET", "/me", token=me["token"])[0] == 200
    assert call("DELETE", f"/devices/{joined['deviceId']}", token=me["token"])[0] == 404


def test_unknown_route_is_404_when_signed_in(table):
    me = create()
    assert call("GET", "/nope", token=me["token"])[0] == 404
