import json
from contextlib import contextmanager
from datetime import date, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from hotelcore.api import app as app_module
from hotelcore.pms.beds24 import BASE_URL, Beds24Client
from hotelcore.tools import ToolContext
from tests.test_tools import HOTEL, fake_beds24

SECRET = "s3cret"
SOON = date.today() + timedelta(days=30)


class FakeConn:
    def __init__(self, log):
        self.log = log

    def execute(self, sql, params=None):
        self.log.append((" ".join(sql.split())[:40], params))
        return self

    def fetchone(self):
        return None

    def fetchall(self):
        return []


class FakePool:
    """Records every statement; enough for the webhook's background writes."""
    def __init__(self):
        self.log = []

    @contextmanager
    def connection(self):
        yield FakeConn(self.log)


@pytest.fixture
def pool():
    return FakePool()


@pytest.fixture
def client(tmp_path, monkeypatch, pool):
    http = httpx.Client(base_url=BASE_URL, transport=httpx.MockTransport(fake_beds24))
    ctx = ToolContext(hotel=HOTEL, pms=Beds24Client(property_id=9, token="t", http=http), data_dir=tmp_path, db=pool)
    monkeypatch.setattr(app_module, "build_context", lambda: ctx)
    monkeypatch.setenv("VAPI_SERVER_SECRET", SECRET)
    monkeypatch.setattr(app_module, "LOG_FILE", tmp_path / "core.log")
    with TestClient(app_module.app) as c:
        yield c


def tool_call(name: str, arguments) -> dict:
    return {"message": {
        "type": "tool-calls",
        "call": {"id": "call-1", "customer": {"number": "+18305550123"}},
        "toolCallList": [{"id": "tc-1", "type": "function", "function": {"name": name, "arguments": arguments}}],
    }}


def test_rejects_missing_or_wrong_secret(client):
    assert client.post("/vapi/webhook", json=tool_call("get_rooms_info", {})).status_code == 401
    assert client.post("/vapi/webhook", json=tool_call("get_rooms_info", {}), headers={"x-vapi-secret": "nope"}).status_code == 401


def test_tool_call_returns_flat_string_result(client):
    args = {"arrival": SOON.isoformat(), "departure": (SOON + timedelta(days=2)).isoformat(), "adults": 2, "children": 0}
    r = client.post("/vapi/webhook", json=tool_call("check_availability", json.dumps(args)), headers={"x-vapi-secret": SECRET})
    assert r.status_code == 200
    item = r.json()["results"][0]
    assert item["toolCallId"] == "tc-1" and json.loads(item["result"])["available"][0]["name"] == "Cabin 2"


def test_tool_failure_uses_error_field_with_http_200(client):
    r = client.post("/vapi/webhook", json=tool_call("check_availability", {"arrival": "bad", "departure": "x", "adults": 1, "children": 0}),
                    headers={"x-vapi-secret": SECRET})
    assert r.status_code == 200 and "year-month-day" in r.json()["results"][0]["error"]


def test_message_and_tool_log_go_to_the_database_with_caller_number(client, pool):
    client.post("/vapi/webhook", json=tool_call("take_message", {"guest_name": "Ann", "phone": "", "reason": "Call me"}),
                headers={"x-vapi-secret": SECRET})
    message = next(p for sql, p in pool.log if sql.startswith("insert into team_messages"))
    assert message["callback_phone"] == "+18305550123" and message["conversation_id"] == "call-1"
    tool = next(p for sql, p in pool.log if sql.startswith("insert into tool_calls"))
    assert tool[0] == "call-1" and tool[2] == "take_message" and tool[4] is True


def test_end_of_call_report_is_stored(client, pool):
    body = {"message": {"type": "end-of-call-report", "call": {"id": "call-1", "customer": {"number": "+1830"}},
                        "artifact": {"messages": [], "transcript": "hi"}, "durationSeconds": 12}}
    assert client.post("/vapi/webhook", json=body, headers={"x-vapi-secret": SECRET}).status_code == 200
    row = next(p for sql, p in pool.log if sql.startswith("insert into calls"))
    assert row["id"] == "call-1" and row["caller_phone"] == "+1830" and row["duration_s"] == 12


def test_dashboard_api_requires_key(client, monkeypatch):
    monkeypatch.setenv("DASHBOARD_API_KEY", "dash")
    assert client.get("/api/versions").status_code == 401
    assert client.get("/api/versions", headers={"x-dashboard-key": "nope"}).status_code == 401


def test_doss_key_reads_but_cannot_roll_back(client, monkeypatch):
    monkeypatch.setenv("DASHBOARD_API_KEY", "dash")
    monkeypatch.setenv("DOSS_API_KEY", "doss")
    doss = {"x-dashboard-key": "doss"}
    assert client.get("/api/versions", headers=doss).status_code == 200
    assert client.get("/api/payments", headers=doss).status_code == 200
    assert client.post("/api/versions/1/rollback", headers=doss).status_code == 403


def test_doss_key_is_refused_when_not_configured(client, monkeypatch):
    monkeypatch.setenv("DASHBOARD_API_KEY", "dash")
    monkeypatch.delenv("DOSS_API_KEY", raising=False)
    assert client.get("/api/versions", headers={"x-dashboard-key": ""}).status_code == 401


def test_recent_log_lines_tail_the_core_log(tmp_path, monkeypatch):
    log_file = tmp_path / "core.log"
    log_file.write_text("".join(f"line {i}\n" for i in range(50)))
    monkeypatch.setattr(app_module, "LOG_FILE", log_file)
    assert app_module.recent_log_lines(3) == ["line 47", "line 48", "line 49"]


def test_doss_can_propose_but_never_approve_reject_or_undo(client, monkeypatch):
    monkeypatch.setenv("DASHBOARD_API_KEY", "dash")
    monkeypatch.setenv("DOSS_API_KEY", "doss")
    doss = {"x-dashboard-key": "doss"}
    for action in ("approve", "reject", "undo"):
        assert client.post(f"/api/changes/1/{action}", headers=doss).status_code == 403
    bad = client.post("/api/changes", headers=doss, json={"proposal": {"title": "t", "reason": "r", "edits": [{"path": ".env", "content": "x"}]}})
    assert bad.status_code == 400 and "not an allowed path" in bad.json()["detail"]
    assert client.post("/api/changes", headers=doss, json={}).status_code == 400


def test_doss_posts_reports_but_only_the_owner_marks_them_read(client, monkeypatch):
    monkeypatch.setenv("DASHBOARD_API_KEY", "dash")
    monkeypatch.setenv("DOSS_API_KEY", "doss")
    doss = {"x-dashboard-key": "doss"}
    assert client.post("/api/reports", headers=doss, json={"title": "", "body": "x"}).status_code == 400
    assert client.post("/api/reports/1/read", headers=doss).status_code == 403
    assert client.get("/api/insights/unanswered", headers=doss).status_code == 200
