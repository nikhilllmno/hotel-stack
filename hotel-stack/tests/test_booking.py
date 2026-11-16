import json
import os
from datetime import date, timedelta
from pathlib import Path

import httpx
import pytest

from hotelcore.config import load_hotel
from hotelcore.pms.beds24 import BASE_URL, Beds24Client
from hotelcore.tools import ToolContext, run_tool
from hotelcore.tools import rooms as rooms_module

HOTEL = load_hotel(Path(__file__).resolve().parent.parent / "hotels" / "contigo-ranch")
SOON = date.today() + timedelta(days=30)
STAY = {"arrival": SOON.isoformat(), "departure": (SOON + timedelta(days=2)).isoformat(), "adults": 2, "children": 0}
GUEST = {"first_name": "Ann", "last_name": "Lee"}


def make_ctx(tmp_path, posted: list, free: bool = True) -> ToolContext:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/api/v2")
        if request.method == "POST":
            posted.extend(json.loads(request.content))
            return httpx.Response(201, json=[{"success": True, "new": {"id": 777}}])
        if path == "/properties":
            data = [{"id": 9, "currency": "USD", "roomTypes": [{"id": 1, "name": "Cabin 2", "maxPeople": 2}]}]
        else:  # /inventory/rooms/offers
            data = [{"roomId": 1, "offers": [{"price": 400, "unitsAvailable": 1 if free else 0}]}]
        return httpx.Response(200, json={"data": data, "pages": {"nextPageExists": False}})

    rooms_module._cache.clear()
    http = httpx.Client(base_url=BASE_URL, transport=httpx.MockTransport(handler))
    return ToolContext(hotel=HOTEL, pms=Beds24Client(property_id=9, token="t", http=http),
                       data_dir=tmp_path, caller_phone="+18305550123")


def test_books_request_with_server_quoted_price_and_caller_phone(tmp_path):
    posted = []
    r = run_tool("create_reservation", {"room_id": 1, **STAY, **GUEST}, make_ctx(tmp_path, posted))
    assert r["ok"] and r["result"]["booking_id"] == 777 and r["result"]["total_price"] == 400
    sent = posted[0]
    assert sent["status"] == "request" and sent["price"] == 400 and sent["phone"] == "+18305550123"
    assert sent["actions"]["checkAvailability"] is True and "AI voice agent" in sent["notes"]


def test_refuses_party_too_big_without_posting(tmp_path):
    posted = []
    r = run_tool("create_reservation", {"room_id": 1, **STAY, "adults": 3, **GUEST}, make_ctx(tmp_path, posted))
    assert r["ok"] is False and "sleeps at most 2" in r["error"] and posted == []


def test_refuses_when_room_no_longer_free(tmp_path):
    posted = []
    r = run_tool("create_reservation", {"room_id": 1, **STAY, **GUEST}, make_ctx(tmp_path, posted, free=False))
    assert r["ok"] is False and "no longer free" in r["error"] and posted == []


@pytest.mark.skipif(not os.environ.get("BEDS24_LIVE_WRITE"), reason="set BEDS24_LIVE_WRITE=1 to create+cancel a real booking")
def test_live_create_then_cancel(tmp_path, monkeypatch):
    from hotelcore.tools import booking
    monkeypatch.setattr(booking, "ACTIONS", {**booking.ACTIONS, "notifyHost": False})  # don't email staff about a test
    rooms_module._cache.clear()
    ctx = ToolContext(hotel=HOTEL, pms=Beds24Client.from_env(), data_dir=tmp_path, caller_phone="+10000000000")
    far = date.today() + timedelta(days=300)
    stay = {"arrival": far.isoformat(), "departure": (far + timedelta(days=1)).isoformat(), "adults": 2, "children": 0}
    free = run_tool("check_availability", stay, ctx)["result"]["available"]
    r = run_tool("create_reservation", {"room_id": free[0]["room_id"], **stay, "first_name": "TEST",
                                        "last_name": "Automated", "notes": "Automated test; cancelled immediately."}, ctx)
    assert r["ok"], r
    booking_id = r["result"]["booking_id"]
    ctx.pms.post("/bookings", [{"id": booking_id, "status": "cancelled", "actions": {"notifyGuest": False, "notifyHost": False}}])
    check = ctx.pms.get_all("/bookings", id=booking_id, status=["cancelled"])[0]
    assert check["status"] == "cancelled" and check["price"] == r["result"]["total_price"]
    print(f"\n  live booking {booking_id}: created as request, price {check['price']}, now cancelled")
