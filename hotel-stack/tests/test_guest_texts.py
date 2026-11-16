from datetime import datetime, timedelta, timezone

import pytest

from hotelcore import guest_texts
from hotelcore.baml_client.types import GuestTextBatch
from hotelcore.changes import ProposalError
from hotelcore.notify import SendError
from tests.test_new_tools import FakeSms, make_ctx


def batch(*items, send_at=None) -> GuestTextBatch:
    return GuestTextBatch.model_validate({"reason": "r", "items": list(items), "send_at": send_at})


class PickySms(FakeSms):
    """Fails for one number (e.g. the guest replied STOP), sends the rest."""
    def send(self, to, body):
        if to == "+18305550002":
            raise SendError("Twilio 400: Attempt to send to unsubscribed recipient")
        return super().send(to, body)


def test_exact_text_is_rendered_per_recipient(tmp_path):
    ctx = make_ctx(tmp_path, [], sms=FakeSms())
    items = guest_texts.render_items(ctx, batch({"to": "+1 (830) 555-0001", "name": "Ann", "text_name": "directions"},
                                                {"to": "+18305550002", "body": "  Gate code is 4321.  "}), None)
    assert items[0]["to"] == "+18305550001" and "Contigo Ranch" in items[0]["body"] and "{" not in items[0]["body"]
    assert items[1]["body"] == "Gate code is 4321."


@pytest.mark.parametrize("bad, message", [
    ([{"to": "830-555-0001", "body": "x"}], "international format"),
    ([{"to": "+18305550001", "body": "x"}, {"to": "+18305550001", "body": "y"}], "listed twice"),
    ([{"to": "+18305550001"}], "either a hotel text"),
    ([{"to": "+18305550001", "text_name": "free_stuff"}], "no text called"),
    ([{"to": f"+1830555{i:04d}", "body": "x"} for i in range(51)], "at most 50"),
])
def test_bad_batches_are_refused_with_a_clear_reason(tmp_path, bad, message):
    with pytest.raises(ProposalError, match=message):
        guest_texts.render_items(make_ctx(tmp_path, [], sms=FakeSms()), batch(*bad), None)


def test_send_at_is_hotel_time_and_never_in_the_past():
    at = guest_texts.parse_send_at("2099-01-02 13:00", "America/Chicago")
    assert at.utcoffset() == timedelta(hours=-6) and at.hour == 13
    assert guest_texts.parse_send_at("", "America/Chicago") is None
    with pytest.raises(ProposalError, match="in the past"):
        guest_texts.parse_send_at("2020-01-01 09:00", "America/Chicago")


def test_one_failed_recipient_does_not_stop_the_others(tmp_path):
    ctx = make_ctx(tmp_path, [], sms=PickySms())
    change = {"id": 9, "proposal": {"items": [{"to": "+18305550001", "body": "a"}, {"to": "+18305550002", "body": "b"},
                                              {"to": "+18305550003", "body": "c"}]}}
    results = guest_texts.send(ctx, change)
    assert [r["ok"] for r in results] == [True, False, True]
    assert "unsubscribed" in results[1]["error"]


def test_approve_sends_now_or_schedules_and_sends_once(tmp_path, monkeypatch):
    from tests.test_api import FakePool
    ctx = make_ctx(tmp_path, [], sms=FakeSms())
    ctx.db = FakePool()
    rows = {}
    monkeypatch.setattr(guest_texts, "get", lambda db, i: rows[i])
    monkeypatch.setattr(guest_texts, "claim", lambda c, i, s: rows[i] if rows[i]["status"] == s and not rows[i].update(status="sending") else None)
    monkeypatch.setattr(guest_texts, "finish", lambda c, i, r: rows[i].update(status="applied", sent=r))
    item = {"to": "+18305550001", "body": "hi"}
    rows[1] = {"id": 1, "kind": "guest_texts", "status": "ready", "send_at": None, "proposal": {"items": [item]}}
    assert guest_texts.approve(ctx, 1, "owner")["sent"] == 1
    assert ctx.sms.sent == [("+18305550001", "hi")] and rows[1]["status"] == "applied"
    with pytest.raises(ProposalError):
        guest_texts.approve(ctx, 1, "owner")  # already sent: never twice
    later = datetime.now(timezone.utc) + timedelta(hours=2)
    rows[2] = {"id": 2, "kind": "guest_texts", "status": "ready", "send_at": later, "proposal": {"items": [item]}}
    assert guest_texts.approve(ctx, 2, "owner")["status"] == "scheduled"
    assert len(ctx.sms.sent) == 1  # nothing sent until it is due
