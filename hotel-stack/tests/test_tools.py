import json
import os
from datetime import date, timedelta
from pathlib import Path

import httpx
import pytest

from hotelcore.config import load_hotel
from hotelcore.pms.beds24 import BASE_URL, Beds24Client
from hotelcore.tools import ToolContext, load_specs, run_tool, specs_for
from hotelcore.tools import rooms as rooms_module

HOTEL = load_hotel(Path(__file__).resolve().parent.parent / "hotels" / "contigo-ranch")
SOON = date.today() + timedelta(days=30)
ROOMS = [{"id": 1, "name": "Cabin 2", "maxPeople": 2}, {"id": 2, "name": "Cabin 1", "maxPeople": 10}]
BOOKINGS = [
    {"id": 11, "lastName": "Mandhani", "firstName": "N", "arrival": SOON.isoformat(), "roomId": 1, "status": "confirmed", "email": "x@y.z"},
    {"id": 12, "lastName": "Other", "arrival": SOON.isoformat(), "roomId": 2, "status": "confirmed"},
]


def fake_beds24(request: httpx.Request) -> httpx.Response:
    path = request.url.path.removeprefix("/api/v2")
    if path == "/properties":
        data = [{"id": 9, "currency": "USD", "roomTypes": ROOMS}]
    elif path == "/inventory/rooms/offers":
        data = [{"roomId": 1, "offers": [{"price": 600, "unitsAvailable": 1}]},
                {"roomId": 2, "offers": [{"price": 1500, "unitsAvailable": 1}]}]
    elif path == "/bookings" and "id" in request.url.params:
        data = [b for b in BOOKINGS if str(b["id"]) == request.url.params["id"]]
    elif path == "/bookings":
        data = BOOKINGS
    else:
        return httpx.Response(500, json={"error": "boom"})
    return httpx.Response(200, json={"data": data, "pages": {"nextPageExists": False}})


@pytest.fixture
def ctx(tmp_path):
    rooms_module._cache.clear()
    http = httpx.Client(base_url=BASE_URL, transport=httpx.MockTransport(fake_beds24))
    return ToolContext(hotel=HOTEL, pms=Beds24Client(property_id=9, token="t", http=http), data_dir=tmp_path)


def test_every_tool_in_yaml_has_code_and_voice_channel():
    specs = load_specs(HOTEL)
    assert {s.name for s in specs_for(specs, "voice")} == set(specs)


def test_rooms_info_joins_beds24_with_facts(ctx):
    r = run_tool("get_rooms_info", {}, ctx)["result"]
    cabin2 = next(x for x in r["rooms"] if x["name"] == "Cabin 2")
    assert cabin2["beds"] == "1 king" and r["check_in_time"] == "3:00 PM"


def test_availability_sorted_and_too_small_rooms_dropped(ctx):
    args = {"arrival": SOON.isoformat(), "departure": (SOON + timedelta(days=3)).isoformat(), "adults": 2, "children": 0}
    r = run_tool("check_availability", args, ctx)["result"]
    assert [x["name"] for x in r["available"]] == ["Cabin 2", "Cabin 1"]
    assert r["available"][0]["nightly_average"] == 200
    r4 = run_tool("check_availability", {**args, "adults": 4}, ctx)["result"]
    assert [x["name"] for x in r4["available"]] == ["Cabin 1"]


def test_availability_rejects_bad_dates_in_plain_words(ctx):
    r = run_tool("check_availability", {"arrival": "2026-12-05", "departure": "2026-12-01", "adults": 2, "children": 0}, ctx)
    assert r == {"ok": False, "error": "Check-out must be after check-in.", "ms": r["ms"]}


def test_find_by_last_name_hides_contact_details(ctx):
    r = run_tool("find_reservation", {"query": "mandhani"}, ctx)["result"]
    assert [m["booking_id"] for m in r["matches"]] == [11]
    assert "email" not in r["matches"][0] and r["matches"][0]["room"] == "Cabin 2"


def test_find_by_booking_number(ctx):
    assert run_tool("find_reservation", {"query": "12"}, ctx)["result"]["matches"][0]["last_name"] == "Other"


def test_knowledge_base_by_title_and_unknown_topics(ctx):
    title = HOTEL.kb["check-in-check-out"].title
    r = run_tool("search_knowledge_base", {"topics": [title, "Spaceport"]}, ctx)["result"]
    assert "3:00 PM" in r["sections"][0]["content"] and r["unknown_topics"] == ["Spaceport"]


def test_take_message_is_stored(ctx):
    run_tool("take_message", {"guest_name": "Ann", "phone": "+18305550000", "reason": "Wedding enquiry"}, ctx)
    saved = json.loads((ctx.data_dir / "messages.jsonl").read_text())
    assert saved["reason"] == "Wedding enquiry" and saved["callback_phone"] == "+18305550000"


def test_pms_outage_becomes_a_polite_sentence(tmp_path):
    http = httpx.Client(base_url=BASE_URL, transport=httpx.MockTransport(lambda r: httpx.Response(503, json={"error": "down"})))
    rooms_module._cache.clear()
    ctx = ToolContext(hotel=HOTEL, pms=Beds24Client(property_id=9, token="t", http=http), data_dir=tmp_path)
    r = run_tool("get_rooms_info", {}, ctx)
    assert r["ok"] is False and "take a message" in r["error"]


@pytest.mark.skipif(not os.environ.get("BEDS24_REFRESH_TOKEN"), reason="live Beds24 credential not set")
def test_live_tools_and_latency(tmp_path, capsys):
    rooms_module._cache.clear()
    ctx = ToolContext(hotel=HOTEL, pms=Beds24Client.from_env(), data_dir=tmp_path)
    stay = {"arrival": SOON.isoformat(), "departure": (SOON + timedelta(days=2)).isoformat(), "adults": 2, "children": 0}
    calls = [("get_rooms_info", {}), ("check_availability", stay), ("find_reservation", {"query": "Mandhani"}),
             ("search_knowledge_base", {"topics": ["Pet Policy"]})]
    with capsys.disabled():
        for name, args in calls:
            r = run_tool(name, args, ctx)
            assert r["ok"], r
            print(f"\n  live {name:22} {r['ms']:5} ms")
