import json
from datetime import date, timedelta
from pathlib import Path

import httpx
import pytest

from hotelcore.config import load_hotel
from hotelcore.notify import SendError
from hotelcore.pms.beds24 import BASE_URL, Beds24Client
from hotelcore.tools import ToolContext, run_tool
from hotelcore.tools import rooms as rooms_module

HOTEL = load_hotel(Path(__file__).resolve().parent.parent / "hotels" / "contigo-ranch")
D0 = date.today() + timedelta(days=30)
iso = lambda d: d.isoformat()  # noqa: E731
BOOKING = {"id": 50, "roomId": 1, "status": "request", "channel": "direct", "arrival": iso(D0),
           "departure": iso(D0 + timedelta(days=2)), "numAdult": 2, "numChild": 0, "price": 400}


def make_ctx(tmp_path, posted: list, booking: dict = BOOKING, sms=None, slack=None) -> ToolContext:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/api/v2")
        if request.method == "POST":
            posted.extend(json.loads(request.content))
            return httpx.Response(201, json=[{"success": True, "modified": {}}])
        if path == "/properties":
            data = [{"id": 9, "currency": "USD", "roomTypes": [{"id": 1, "name": "Cabin 2", "maxPeople": 2}]}]
        elif path == "/bookings":
            data = [booking]
        else:  # offers: 150 per added night
            p = request.url.params
            nights = (date.fromisoformat(p["departure"]) - date.fromisoformat(p["arrival"])).days
            data = [{"roomId": 1, "offers": [{"price": 150 * nights, "unitsAvailable": 1}]}]
        return httpx.Response(200, json={"data": data, "pages": {"nextPageExists": False}})

    rooms_module._cache.clear()
    http = httpx.Client(base_url=BASE_URL, transport=httpx.MockTransport(handler))
    return ToolContext(hotel=HOTEL, pms=Beds24Client(property_id=9, token="t", http=http), data_dir=tmp_path,
                       caller_phone="+18305550123", sms=sms, slack=slack)


def test_modify_quote_only_does_not_write(tmp_path):
    posted = []
    r = run_tool("modify_reservation", {"booking_id": 50, "confirm": False, "departure": iso(D0 + timedelta(days=3))},
                 make_ctx(tmp_path, posted))["result"]
    assert r["changed"] is False and posted == []
    assert r["new_total"] == 400 + 150  # 2 kept nights at 200 + 1 added night quoted at 150


def test_modify_confirm_writes_new_dates_and_price(tmp_path):
    posted = []
    args = {"booking_id": 50, "confirm": True, "arrival": iso(D0 + timedelta(days=1)), "departure": iso(D0 + timedelta(days=3))}
    r = run_tool("modify_reservation", args, make_ctx(tmp_path, posted))["result"]
    assert r["changed"] is True
    assert posted[0]["id"] == 50 and posted[0]["price"] == 200 + 150 and posted[0]["arrival"] == args["arrival"]


def test_modify_refuses_external_channel(tmp_path):
    r = run_tool("modify_reservation", {"booking_id": 50, "confirm": False},
                 make_ctx(tmp_path, [], booking={**BOOKING, "channel": "booking"}))
    assert r["ok"] is False and "made through booking" in r["error"]


def test_modify_refuses_too_many_guests(tmp_path):
    r = run_tool("modify_reservation", {"booking_id": 50, "confirm": False, "adults": 4}, make_ctx(tmp_path, []))
    assert r["ok"] is False and "sleeps at most 2" in r["error"]


class FakeSms:
    def __init__(self, fail=False):
        self.sent, self.fail = [], fail

    def send(self, to, body):
        if self.fail:
            raise SendError("nope")
        self.sent.append((to, body))
        return "SM1"


def test_send_text_sends_rendered_template(tmp_path):
    sms = FakeSms()
    r = run_tool("send_text", {"template": "wedding_request_form", "to": "+18305550999"}, make_ctx(tmp_path, [], sms=sms))
    assert r["result"]["sent"] is True
    to, body = sms.sent[0]
    assert to == "+18305550999" and "Contigo Ranch" in body and "tripleseat" in body and "{" not in body


def test_send_text_booking_confirmation_has_deposit_and_link(tmp_path):
    sms = FakeSms()
    r = run_tool("send_text", {"template": "booking_confirmation", "to": "+18305550999", "booking_id": 50}, make_ctx(tmp_path, [], sms=sms))
    body = sms.sent[0][1]
    assert r["result"]["sent"] is True
    assert "#50" in body and "Cabin 2" in body and "$400" in body and "($200)" in body and "/pay/" in body and "{" not in body


def test_send_text_booking_template_needs_booking_id(tmp_path):
    r = run_tool("send_text", {"template": "payment_link", "to": "+18305550999"}, make_ctx(tmp_path, [], sms=FakeSms()))
    assert r["ok"] is False and "booking number" in r["error"]


def test_send_text_failures_return_sent_false(tmp_path):
    no_sms = run_tool("send_text", {"template": "directions", "to": "+18305550999"}, make_ctx(tmp_path, []))
    failing = run_tool("send_text", {"template": "directions", "to": "+18305550999"}, make_ctx(tmp_path, [], sms=FakeSms(fail=True)))
    assert no_sms["result"]["sent"] is False and failing["result"]["sent"] is False


def test_send_text_rejects_unknown_template(tmp_path):
    r = run_tool("send_text", {"template": "free_stuff", "to": "+18305550999"}, make_ctx(tmp_path, [], sms=FakeSms()))
    assert r["ok"] is False


def test_upset_guest_without_slack_is_not_alerted(tmp_path):
    r = run_tool("alert_upset_guest", {"guest_name": "Mark", "phone": "+1202", "issue": "No hot water"}, make_ctx(tmp_path, []))
    assert r["result"] == {"alerted": False}


@pytest.mark.parametrize("ok", [True, False])
def test_upset_guest_with_slack(tmp_path, ok):
    class FakeSlack:
        def __init__(self):
            self.posts = []

        def post(self, text):
            if not ok:
                raise SendError("down")
            self.posts.append(text)

    slack = FakeSlack()
    r = run_tool("alert_upset_guest", {"guest_name": "Mark", "phone": "+1202", "issue": "No hot water"}, make_ctx(tmp_path, [], slack=slack))
    assert r["result"] == {"alerted": ok} and (("No hot water" in slack.posts[0]) if ok else slack.posts == [])


def test_new_sms_template_is_offered_without_other_changes(tmp_path):
    import shutil
    from hotelcore.tools.registry import load_specs
    root = tmp_path / "hotel"
    shutil.copytree(HOTEL.root, root)
    with open(root / "sms_templates.yaml", "a") as f:
        f.write("\nspa_menu:\n  description: The spa menu.\n  text: Spa menu at {{facts.property.website}}\n")
    template = load_specs(load_hotel(root))["send_text"].parameters["properties"]["template"]
    assert "spa_menu" in template["enum"] and "payment_receipt" not in template["enum"]
