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


def create(name: str = "Victor's iPhone") -> dict:
    status, body = call("POST", "/household", {"deviceName": name})
    assert status == 201
    return body


def test_health_needs_no_sign_in(table):
    assert call("GET", "/health") == (200, {"ok": True})


def test_create_household_returns_a_working_token(table):
    me = create()
    status, body = call("GET", "/me", token=me["token"])
    assert status == 200
    assert body == {"householdId": me["householdId"], "deviceId": me["deviceId"], "deviceName": "Victor's iPhone"}


def test_only_one_household_can_exist(table):
    create()
    status, _ = call("POST", "/household", {"deviceName": "Stranger"})
    assert status == 409


def test_missing_blank_or_invalid_device_names_get_a_default(table):
    status, body = call("POST", "/household", "not json")
    assert status == 201
    assert call("GET", "/me", token=body["token"])[1]["deviceName"] == "Device"
    invite = call("POST", "/invites", token=body["token"])[1]
    joined = call("POST", "/join", {"code": invite["code"], "deviceName": "   "})[1]
    assert call("GET", "/me", token=joined["token"])[1]["deviceName"] == "Device"


def test_long_device_name_is_truncated(table):
    me = create("x" * 100)
    assert len(call("GET", "/me", token=me["token"])[1]["deviceName"]) == 40


def test_invite_lets_a_second_device_join_and_works_once(table):
    me = create()
    status, invite = call("POST", "/invites", token=me["token"])
    assert status == 201
    status, joined = call("POST", "/join", {"code": invite["code"], "deviceName": "Yara's iPhone"})
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
    joined = call("POST", "/join", {"code": invite["code"], "deviceName": "Yara's iPhone"})[1]
    devices = call("GET", "/devices", token=joined["token"])[1]["devices"]
    assert [d["name"] for d in devices] == ["Victor's iPhone", "Yara's iPhone"]
    assert [d["current"] for d in devices] == [False, True]


def test_revoking_a_device_signs_it_out(table):
    me = create()
    invite = call("POST", "/invites", token=me["token"])[1]
    joined = call("POST", "/join", {"code": invite["code"], "deviceName": "Yara's iPhone"})[1]
    assert call("DELETE", f"/devices/{joined['deviceId']}", token=me["token"])[0] == 204
    assert call("GET", "/me", token=joined["token"])[0] == 401
    assert call("GET", "/me", token=me["token"])[0] == 200
    assert call("DELETE", f"/devices/{joined['deviceId']}", token=me["token"])[0] == 404


def test_unknown_route_is_404_when_signed_in(table):
    me = create()
    assert call("GET", "/nope", token=me["token"])[0] == 404


def test_the_only_device_cannot_be_removed(table):
    me = create()
    status, body = call("DELETE", f"/devices/{me['deviceId']}", token=me["token"])
    assert status == 409
    assert "only device" in body["error"]
    assert call("GET", "/me", token=me["token"])[0] == 200


def test_a_device_can_remove_itself_when_another_remains(table):
    me = create()
    invite = call("POST", "/invites", token=me["token"])[1]
    joined = call("POST", "/join", {"code": invite["code"], "deviceName": "Yara"})[1]
    assert call("DELETE", f"/devices/{me['deviceId']}", token=joined["token"])[0] == 204
    assert call("GET", "/me", token=me["token"])[0] == 401
    assert call("GET", "/me", token=joined["token"])[0] == 200


def test_me_is_refused_when_the_device_record_is_missing(table):
    me = create()
    table.delete_item(Key={"PK": f"H#{me['householdId']}", "SK": f"DEVICE#{me['deviceId']}"})
    assert call("GET", "/me", token=me["token"])[0] == 401


def test_a_failed_claim_leaves_nothing_behind(table):
    create()
    before = table.scan()["Count"]
    assert call("POST", "/household", {"deviceName": "Stranger"})[0] == 409
    assert table.scan()["Count"] == before


def test_health_does_not_touch_the_table(monkeypatch):
    from api import handler as h

    h.get_table.cache_clear()
    monkeypatch.delenv("TABLE_NAME", raising=False)
    assert call("GET", "/health") == (200, {"ok": True})
