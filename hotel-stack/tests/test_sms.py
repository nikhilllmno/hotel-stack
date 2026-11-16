from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from hotelcore.api import app as app_module
from hotelcore.api.twilio_sms import twilio_signature
from hotelcore.text_agent import guest_context
from tests.test_api import FakePool, client as api_client, pool  # noqa: F401  (fixtures)

URL = "https://example.test"


class RowsConn:
    """Returns canned rows: first query = texts (newest first), second = latest call."""
    def __init__(self, texts, call=None):
        self.answers = [texts, [call] if call else []]

    def execute(self, sql, params=None):
        rows = self.answers.pop(0)
        class R:
            def fetchall(_): return rows
            def fetchone(_): return rows[0] if rows else None
        return R()


def test_history_alternates_and_starts_with_guest():
    texts = [{"direction": "in", "body": "c"}, {"direction": "in", "body": "b"},
             {"direction": "out", "body": "hi"}, {"direction": "out", "body": "older reply"}][::1]
    turns, note = guest_context(RowsConn(texts), "+1")
    assert [t["role"] for t in turns] == ["user"] and turns[0]["content"] == "b\nc"
    assert note == ""


def test_history_includes_latest_call_summary():
    from datetime import datetime
    turns, note = guest_context(RowsConn([{"direction": "in", "body": "hey"}],
                                         {"started_at": datetime(2026, 11, 10), "summary": "Asked about Cabin 2"}), "+1")
    assert "Asked about Cabin 2" in note and "Nov 10" in note


@pytest.fixture
def sms_client(api_client, monkeypatch):  # noqa: F811
    monkeypatch.setenv("PUBLIC_BASE_URL", URL)
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "tok")
    calls = []
    monkeypatch.setattr("hotelcore.api.twilio_sms.reply_to", lambda *a: calls.append(a))
    return api_client, calls


def test_rejects_unsigned_sms(sms_client):
    client, calls = sms_client
    r = client.post("/twilio/sms", data={"From": "+1", "Body": "hi", "MessageSid": "SM1"})
    assert r.status_code == 403 and calls == []


def test_accepts_signed_sms_and_replies_in_background(sms_client):
    client, calls = sms_client
    data = {"From": "+18305550123", "Body": " hi ", "MessageSid": "SM1"}
    sig = twilio_signature("tok", URL + "/twilio/sms", data)
    r = client.post("/twilio/sms", data=data, headers={"x-twilio-signature": sig})
    assert r.status_code == 200 and "<Response>" in r.text
    assert calls[0][1:] == ("+18305550123", "hi", "SM1")
