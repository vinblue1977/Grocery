import pytest
from test_api import call, create


@pytest.fixture
def me(table):
    return create("Victor")


def sync(me) -> dict:
    status, body = call("GET", "/sync", token=me["token"])
    assert status == 200
    return body


def store_id(me, name: str) -> str:
    return next(s["id"] for s in sync(me)["stores"] if s["name"] == name)


def add(me, store: str, name: str, **extra) -> dict:
    status, body = call("POST", "/items", {"storeId": store, "name": name, **extra}, me["token"])
    assert status == 201, body
    return body


def test_first_sync_creates_the_default_stores_once(me):
    first = sync(me)
    assert [s["name"] for s in first["stores"]] == ["Costco", "Patel", "Butcher"]
    assert first["items"] == []
    assert [s["id"] for s in sync(me)["stores"]] == [s["id"] for s in first["stores"]]


def test_deleting_every_store_sticks(me):
    for s in sync(me)["stores"]:
        assert call("DELETE", f"/stores/{s['id']}", token=me["token"])[0] == 204
    assert sync(me)["stores"] == []


def test_add_and_check_off_an_item(me):
    costco = store_id(me, "Costco")
    item = add(me, costco, "  Milk   2 gal ", note="whole")
    assert item["name"] == "Milk 2 gal"
    assert item["note"] == "whole"
    assert item["checked"] is False
    assert item["addedBy"] == "Victor"
    status, updated = call("PATCH", f"/items/{item['id']}", {"checked": True}, me["token"])
    assert status == 200
    assert updated["checked"] is True
    assert sync(me)["items"][0]["checked"] is True


def test_edit_and_delete_an_item(me):
    item = add(me, store_id(me, "Patel"), "Dal")
    status, body = call("PATCH", f"/items/{item['id']}", {"name": "Toor dal", "note": "1 kg"}, me["token"])
    assert (status, body["name"], body["note"]) == (200, "Toor dal", "1 kg")
    assert call("DELETE", f"/items/{item['id']}", token=me["token"])[0] == 204
    assert sync(me)["items"] == []
    assert call("DELETE", f"/items/{item['id']}", token=me["token"])[0] == 404


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("POST", "/items", {"storeId": "nope", "name": "x"}),
        ("POST", "/items", {"name": "x"}),
        ("POST", "/items", {"storeId": 5, "name": "x"}),
        ("PATCH", "/items/nope", {"checked": True}),
        ("PATCH", "/stores/nope", {"name": "x"}),
        ("DELETE", "/stores/nope", None),
        ("POST", "/stores/nope/clear", None),
        ("GET", "/nothing", None),
        ("PUT", "/stores", None),
    ],
)
def test_unknown_targets_are_404_or_400(me, method, path, body):
    status, _ = call(method, path, body, me["token"])
    assert status in (400, 404)


def test_bad_values_are_rejected(me):
    costco = store_id(me, "Costco")
    for body in ({"storeId": costco, "name": "   "}, {"storeId": costco, "name": 7}, {"storeId": costco}):
        assert call("POST", "/items", body, me["token"])[0] == 400
    item = add(me, costco, "Eggs")
    assert call("PATCH", f"/items/{item['id']}", {"checked": "yes"}, me["token"])[0] == 400
    assert call("PATCH", f"/items/{item['id']}", {"name": ""}, me["token"])[0] == 400
    assert call("POST", "/stores", {"name": ""}, me["token"])[0] == 400


def test_long_text_is_cut(me):
    item = add(me, store_id(me, "Costco"), "x" * 500, note="y" * 500)
    assert (len(item["name"]), len(item["note"])) == (80, 120)


def test_stores_can_be_added_renamed_and_removed_with_their_items(me):
    sync(me)  # creates the default stores first
    status, store = call("POST", "/stores", {"name": "Trader Joe's"}, me["token"])
    assert status == 201
    assert store["order"] == 3
    assert call("PATCH", f"/stores/{store['id']}", {"name": "TJ's"}, me["token"])[1]["name"] == "TJ's"
    add(me, store["id"], "Cookies")
    keep = add(me, store_id(me, "Costco"), "Eggs")
    assert call("DELETE", f"/stores/{store['id']}", token=me["token"])[0] == 204
    assert [i["id"] for i in sync(me)["items"]] == [keep["id"]]
    assert "TJ's" not in [s["name"] for s in sync(me)["stores"]]


def test_clear_checked_only_removes_ticked_items_in_that_store(me):
    costco, patel = store_id(me, "Costco"), store_id(me, "Patel")
    done, todo, other = add(me, costco, "Eggs"), add(me, costco, "Milk"), add(me, patel, "Rice")
    call("PATCH", f"/items/{done['id']}", {"checked": True}, me["token"])
    call("PATCH", f"/items/{other['id']}", {"checked": True}, me["token"])
    status, body = call("POST", f"/stores/{costco}/clear", token=me["token"])
    assert (status, body) == (200, {"removed": 1})
    assert {i["id"] for i in sync(me)["items"]} == {todo["id"], other["id"]}


def test_both_people_see_the_same_list_and_who_added_what(me):
    invite = call("POST", "/invites", token=me["token"])[1]
    yara = call("POST", "/join", {"code": invite["code"], "deviceName": "Yara"})[1]
    add(me, store_id(me, "Costco"), "Milk")
    add(yara, store_id(yara, "Costco"), "Bananas")
    seen = sync(yara)["items"]
    assert [(i["name"], i["addedBy"]) for i in seen] == [("Milk", "Victor"), ("Bananas", "Yara")]
    assert sync(me)["items"] == seen


def test_limits_on_stores_and_items(me, monkeypatch):
    from api import lists

    sync(me)  # creates the three default stores
    monkeypatch.setattr(lists, "MAX_STORES", 3)
    assert call("POST", "/stores", {"name": "Fourth"}, me["token"])[0] == 400
    monkeypatch.setattr(lists, "MAX_ITEMS", 1)
    costco = store_id(me, "Costco")
    add(me, costco, "One")
    assert call("POST", "/items", {"storeId": costco, "name": "Two"}, me["token"])[0] == 400


def test_lists_need_sign_in(table):
    create()
    assert call("GET", "/sync")[0] == 401
    assert call("POST", "/items", {"storeId": "x", "name": "y"})[0] == 401


def test_editing_a_deleted_item_or_store_does_not_bring_it_back(me):
    costco = store_id(me, "Costco")
    item = add(me, costco, "Milk")
    assert call("DELETE", f"/items/{item['id']}", token=me["token"])[0] == 204
    assert call("PATCH", f"/items/{item['id']}", {"checked": True}, me["token"])[0] == 404
    assert call("DELETE", f"/stores/{costco}", token=me["token"])[0] == 204
    assert call("PATCH", f"/stores/{costco}", {"name": "Back again"}, me["token"])[0] == 404
    assert sync(me)["items"] == []
    assert "Costco" not in [s["name"] for s in sync(me)["stores"]]


def test_checking_an_item_keeps_a_concurrent_note_edit(me):
    item = add(me, store_id(me, "Costco"), "Milk")
    call("PATCH", f"/items/{item['id']}", {"note": "whole"}, me["token"])
    call("PATCH", f"/items/{item['id']}", {"checked": True}, me["token"])
    assert sync(me)["items"][0] | {"updatedAt": 0} == {**item, "note": "whole", "checked": True, "updatedAt": 0}


def test_adding_to_a_store_deleted_a_moment_ago_fails_cleanly(me):
    costco = store_id(me, "Costco")
    call("DELETE", f"/stores/{costco}", token=me["token"])
    assert call("POST", "/items", {"storeId": costco, "name": "Late"}, me["token"])[0] == 404
    assert table_item_count(me) == 0


def table_item_count(me) -> int:
    from api.handler import get_table

    return len([r for r in get_table().scan()["Items"] if r["SK"].startswith("ITEM#")])


def test_orphaned_items_never_show(me):
    from api.handler import get_table

    sync(me)
    get_table().put_item(
        Item={
            "PK": f"H#{me['householdId']}",
            "SK": "ITEM#ghost",
            "id": "ghost",
            "storeId": "gone",
            "name": "x",
            "checked": False,
            "addedBy": "V",
            "updatedAt": 1,
        }
    )
    assert sync(me)["items"] == []


def test_seeding_twice_creates_one_set_of_stores(me):
    from api import lists
    from api.handler import get_table
    from api.households import Session

    session = Session(me["householdId"], me["deviceId"])
    lists._seed_defaults(get_table(), session)
    lists._seed_defaults(get_table(), session)  # a concurrent first sync: the second one loses the marker race and adds nothing
    assert [s["name"] for s in sync(me)["stores"]] == ["Costco", "Patel", "Butcher"]
