import json

import pytest

from hotelcore import mini_apps
from hotelcore.baml_client.types import MiniApp
from hotelcore.changes import ProposalError
from tests.test_api import client, pool  # noqa: F401  (fixtures)
from tests.test_tools import HOTEL


def app(**kw) -> MiniApp:
    return MiniApp.model_validate({"slug": "arrivals-board", "title": "Arrivals", "description": "d",
                                   "html": "<html><head></head><body>hi</body></html>", "for_guests": False, **kw})


@pytest.mark.parametrize("kw, message", [
    ({"slug": "Arrivals Board"}, "lowercase"),
    ({"slug": "../x"}, "lowercase"),
    ({"html": "<script src='https://evil.example/x.js'></script>"}, "external scripts"),
    ({"html": "   "}, "html must be"),
])
def test_bad_apps_are_refused(kw, message):
    with pytest.raises(ProposalError, match=message):
        mini_apps.validate(app(**kw))


def test_public_info_never_contains_internal_facts_or_agent_instructions():
    info = mini_apps.public_info(HOTEL)
    text = json.dumps(info)
    assert HOTEL.facts["contact"]["after_hours_phone"] not in text
    assert info["facts"]["property.name"] == "Contigo Ranch" and "contact.after_hours_phone" not in info["facts"]
    titles = {k["title"] for k in info["kb"]}
    assert "AI Handling Guidelines" not in titles and "Human Escalation & Contact" not in titles
    assert "{{" not in text


def test_bridge_goes_before_the_page_scripts():
    out = mini_apps.with_bridge("<html><head><script>use()</script></head></html>", "<script>bridge()</script>")
    assert out.index("bridge()") < out.index("use()")
    assert mini_apps.with_bridge("<div>no head</div>", "<b>").startswith("<b>")


def test_unknown_or_owner_only_pages_are_not_public(client):  # noqa: F811
    r = client.get("/p/arrivals-board")
    assert r.status_code == 404  # FakePool finds no public row


def test_public_availability_hides_internal_ids(client, monkeypatch):  # noqa: F811
    from hotelcore.api import apps_api
    monkeypatch.setattr(apps_api, "check_availability", lambda *a: {
        "available": [{"room_id": 7, "name": "Cabin 2", "max_guests": 2, "beds": "1 king", "total_price": 400, "nightly_average": 200}],
        "nights": 2})
    out = client.get("/p/api/availability", params={"arrival": "2026-12-01", "departure": "2026-12-03"}).json()
    assert out["available"] == [{"name": "Cabin 2", "max_guests": 2, "beds": "1 king", "total_price": 400, "nightly_average": 200}]
    assert out["book_url"].startswith("https://")


def test_owner_data_needs_a_key(client, monkeypatch):  # noqa: F811
    monkeypatch.setenv("DASHBOARD_API_KEY", "dash")
    assert client.get("/api/live/reservations", params={"arrival_from": "2026-12-01", "arrival_to": "2026-12-07"}).status_code == 401
    assert client.get("/api/apps").status_code == 401
