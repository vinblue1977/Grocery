import hashlib
import json

from test_api import call, create

from api import households


def test_recovery_code_signs_in_a_new_device_and_stays_valid(table):
    me = create()
    status, made = call("POST", "/recovery", token=me["token"])
    assert status == 201
    assert made["code"].startswith("rec_")
    for name in ("New phone", "Another"):  # not consumed: works again
        status, creds = call("POST", "/recover", {"code": made["code"], "deviceName": name})
        assert status == 201
        assert creds["householdId"] == me["householdId"]
        assert call("GET", "/me", token=creds["token"])[1]["deviceName"] == name


def test_recovery_needs_sign_in_to_create_but_not_to_use(table):
    create()
    assert call("POST", "/recovery")[0] == 401
    assert call("POST", "/recovery", token="nope")[0] == 401


def test_bad_recovery_codes_are_a_generic_400_and_create_nothing(table):
    me = create()
    call("POST", "/recovery", token=me["token"])
    keys = lambda: {(i["PK"], i["SK"]) for i in table.scan()["Items"]}  # noqa: E731
    before = keys()
    for code in ("rec_wrong", "", None, 123, ["x"], "x" * 500):
        assert call("POST", "/recover", {"code": code, "deviceName": "Thief"}) == (400, {"error": "invalid recovery code"})
    assert call("POST", "/recover", "not json") == (400, {"error": "invalid recovery code"})
    assert keys() == before
    assert len(call("GET", "/devices", token=me["token"])[1]["devices"]) == 1


def test_recover_without_a_household_or_a_code_is_400(table):
    assert call("POST", "/recover", {"code": "rec_x"})[0] == 400
    me = create()  # household exists but no code was ever made
    assert call("POST", "/recover", {"code": "rec_x"})[0] == 400
    assert call("GET", "/me", token=me["token"])[0] == 200


def test_a_new_recovery_code_replaces_the_old_one(table):
    me = create()
    old = call("POST", "/recovery", token=me["token"])[1]["code"]
    new = call("POST", "/recovery", token=me["token"])[1]["code"]
    assert old != new
    assert call("POST", "/recover", {"code": old})[0] == 400
    assert call("POST", "/recover", {"code": new})[0] == 201


def test_recovery_code_is_stored_only_as_a_hash(table):
    me = create()
    code = call("POST", "/recovery", token=me["token"])[1]["code"]
    row = table.get_item(Key={"PK": f"H#{me['householdId']}", "SK": "META#RECOVERY"})["Item"]
    assert row["codeHash"] == hashlib.sha256(code.encode()).hexdigest()
    assert code not in json.dumps(table.scan()["Items"], default=str)


def test_wrong_guesses_never_lock_out_the_real_code(table):
    me = create()
    code = call("POST", "/recovery", token=me["token"])[1]["code"]
    for _ in range(30):
        assert call("POST", "/recover", {"code": "rec_guess"})[0] == 400
    assert call("POST", "/recover", {"code": code})[0] == 201


def test_rotating_the_code_between_check_and_write_mints_no_device(table, monkeypatch):
    me = create()
    old = call("POST", "/recovery", token=me["token"])[1]["code"]
    real_transact = households.transact

    def rotate_then_write(tbl, ops):
        call("POST", "/recovery", token=me["token"])  # someone replaces the code after it was verified
        return real_transact(tbl, ops)

    monkeypatch.setattr(households, "transact", rotate_then_write)
    assert call("POST", "/recover", {"code": old, "deviceName": "Late"}) == (400, {"error": "invalid recovery code"})
    monkeypatch.undo()
    assert len(call("GET", "/devices", token=me["token"])[1]["devices"]) == 1
