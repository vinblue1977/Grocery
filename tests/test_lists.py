import pytest
from test_api import call, create


@pytest.fixture
def me(table):
    return create("Vinod")


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
    assert item["addedBy"] == "Vinod"
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
    yaso = call("POST", "/join", {"code": invite["code"], "deviceName": "Yaso"})[1]
    add(me, store_id(me, "Costco"), "Milk")
    add(yaso, store_id(yaso, "Costco"), "Bananas")
    seen = sync(yaso)["items"]
    assert [(i["name"], i["addedBy"]) for i in seen] == [("Milk", "Vinod"), ("Bananas", "Yaso")]
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


def freq(me, store: str | None = None) -> list[dict]:
    rows = sync(me)["frequent"]
    return [r for r in rows if store is None or r["storeId"] == store]


def put_freq(me, store: str, name: str, **changes):
    return call("PUT", "/frequent", {"storeId": store, "name": name, **changes}, me["token"])


def test_an_item_added_three_times_is_suggested_for_that_store(me):
    costco, patel = store_id(me, "Costco"), store_id(me, "Patel")
    for _ in range(2):
        add(me, costco, "Milk")
    assert freq(me) == []  # twice is not often yet
    add(me, costco, "milk")  # case does not matter
    assert [(f["name"], f["count"], f["storeId"]) for f in freq(me)] == [("milk", 3, costco)]
    assert freq(me, patel) == []  # counts are per store


def test_scanned_items_count_too(me):
    costco = store_id(me, "Costco")
    for _ in range(3):
        status, _body = call("POST", "/items/bulk", {"items": [{"name": "Eggs", "note": "", "storeId": costco}]}, me["token"])
        assert status == 201
        for item in sync(me)["items"]:
            call("DELETE", f"/items/{item['id']}", token=me["token"])  # so the next scan is not skipped as a duplicate
    assert [f["name"] for f in freq(me)] == ["Eggs"]


def test_pinning_shows_an_item_at_once_and_hiding_removes_it(me):
    costco = store_id(me, "Costco")
    status, body = put_freq(me, costco, "Saffron", pinned=True)
    assert status == 200 and body["pinned"] is True and body["count"] == 0
    assert [(f["name"], f["pinned"]) for f in freq(me)] == [("Saffron", True)]
    assert put_freq(me, costco, "saffron", hidden=True)[1]["pinned"] is False  # hiding un-pins
    assert freq(me) == []
    put_freq(me, costco, "Saffron", pinned=True)  # pinning brings it back
    assert [f["name"] for f in freq(me)] == ["Saffron"]


def test_a_hidden_item_stays_hidden_even_as_it_keeps_being_added(me):
    costco = store_id(me, "Costco")
    put_freq(me, costco, "Milk", hidden=True)
    for _ in range(4):
        add(me, costco, "Milk")
    assert freq(me) == []


def test_pinned_come_first_then_most_added(me):
    costco = store_id(me, "Costco")
    for name, times in (("Rice", 3), ("Milk", 5)):
        for _ in range(times):
            add(me, costco, name)
    put_freq(me, costco, "Saffron", pinned=True)
    assert [f["name"] for f in freq(me)] == ["Saffron", "Milk", "Rice"]


def test_deleting_a_store_forgets_its_suggestions(me):
    costco = store_id(me, "Costco")
    for _ in range(3):
        add(me, costco, "Milk")
    assert call("DELETE", f"/stores/{costco}", token=me["token"])[0] == 204
    assert freq(me) == []
    assert call("GET", "/sync", token=me["token"])[1]["stores"]  # the others are untouched


def test_frequent_validation(me):
    costco = store_id(me, "Costco")
    assert put_freq(me, costco, "", pinned=True)[0] == 400
    assert put_freq(me, costco, "Milk")[0] == 400  # neither pinned nor hidden
    assert put_freq(me, costco, "Milk", pinned="yes")[0] == 400
    assert put_freq(me, "nope", "Milk", pinned=True)[0] == 404
    assert call("PUT", "/frequent", {"name": "Milk", "pinned": True}, me["token"])[0] == 400  # no store
    assert call("PUT", "/frequent", {"storeId": costco, "name": "Milk", "pinned": True})[0] == 401  # signed out


def test_the_history_is_capped_and_pinned_names_survive(me, table, monkeypatch):
    from api import lists

    monkeypatch.setattr(lists, "MAX_FREQ", 3)
    costco = store_id(me, "Costco")
    put_freq(me, costco, "Saffron", pinned=True)
    for name in ("A", "B", "C"):
        add(me, costco, name)
    sync(me)  # trims on read
    rows = table.query(KeyConditionExpression="PK = :pk", ExpressionAttributeValues={":pk": f"H#{me['householdId']}"})["Items"]
    kept = [r["SK"] for r in rows if r["SK"].startswith("FREQ#")]
    assert len(kept) == 3 and any(sk.endswith("#saffron") for sk in kept)


def test_sync_clears_history_of_stores_that_no_longer_exist(me, table):
    table.put_item(
        Item={
            "PK": f"H#{me['householdId']}",
            "SK": "FREQ#gone#milk",
            "storeId": "gone",
            "name": "Milk",
            "count": 9,
            "pinned": False,
            "hidden": False,
            "updatedAt": 1,
        }
    )
    sync(me)
    rows = table.query(KeyConditionExpression="PK = :pk", ExpressionAttributeValues={":pk": f"H#{me['householdId']}"})["Items"]
    assert not any(r["SK"].startswith("FREQ#gone") for r in rows)


def test_the_cap_never_forgets_a_hidden_choice(me, table, monkeypatch):
    from api import lists

    monkeypatch.setattr(lists, "MAX_FREQ", 2)
    costco = store_id(me, "Costco")
    put_freq(me, costco, "Milk", hidden=True)  # count 0, the lowest, yet it must survive
    for name in ("A", "B", "C"):
        add(me, costco, name)
    sync(me)
    rows = table.query(KeyConditionExpression="PK = :pk", ExpressionAttributeValues={":pk": f"H#{me['householdId']}"})["Items"]
    kept = {r["SK"] for r in rows if r["SK"].startswith("FREQ#")}
    assert any(sk.endswith("#milk") for sk in kept)


def post(me, path: str, body: dict):
    return call("POST", path, body, me["token"])


def test_an_item_added_twice_with_the_same_id_is_created_once(me):
    costco = store_id(me, "Costco")
    first = post(me, "/items", {"storeId": costco, "name": "Milk", "id": "a" * 12})
    assert first[0] == 201 and first[1]["id"] == "a" * 12
    again = post(me, "/items", {"storeId": costco, "name": "Milk", "id": "a" * 12})
    assert again[0] == 200 and again[1]["id"] == "a" * 12  # a replay returns what is already there
    assert [i["name"] for i in sync(me)["items"]] == ["Milk"]


def test_a_replayed_add_does_not_count_twice_toward_suggestions(me):
    costco = store_id(me, "Costco")
    for _ in range(4):
        post(me, "/items", {"storeId": costco, "name": "Milk", "id": "b" * 12})  # one real add, replayed three times
    add(me, costco, "Milk")  # the second real add
    assert freq(me) == []  # two real adds: not yet often
    add(me, costco, "Milk")  # the third
    assert [f["count"] for f in freq(me)] == [3]


def test_a_replayed_add_returns_the_existing_item_even_after_it_was_checked_off(me):
    costco = store_id(me, "Costco")
    item = post(me, "/items", {"storeId": costco, "name": "Eggs", "id": "c" * 16})[1]
    assert call("PATCH", f"/items/{item['id']}", {"checked": True}, me["token"])[0] == 200
    again = post(me, "/items", {"storeId": costco, "name": "Eggs", "id": "c" * 16})
    assert again[0] == 200 and again[1]["checked"] is True  # not turned back into a new unchecked item


def test_a_store_added_twice_with_the_same_id_is_created_once(me):
    first = post(me, "/stores", {"name": "Aldi", "id": "d" * 12})
    assert first[0] == 201
    again = post(me, "/stores", {"name": "Aldi", "id": "d" * 12})
    assert again[0] == 200 and again[1] == first[1]
    assert [s["name"] for s in sync(me)["stores"]].count("Aldi") == 1


@pytest.mark.parametrize("bad", ["short", "G" * 12, "a" * 33, "../../x" * 3, 12345, ""])
def test_a_bad_client_id_is_rejected(me, bad):
    costco = store_id(me, "Costco")
    assert post(me, "/items", {"storeId": costco, "name": "Milk", "id": bad})[0] == 400
    assert post(me, "/stores", {"name": "Aldi", "id": bad})[0] == 400


def test_a_replayed_add_into_a_deleted_store_is_not_found(me):
    costco = store_id(me, "Costco")
    call("DELETE", f"/stores/{costco}", token=me["token"])
    assert post(me, "/items", {"storeId": costco, "name": "Milk", "id": "f" * 12})[0] == 404
