import asyncio

import httpx
import pytest

from hotelcore import doss_mcp


@pytest.fixture
def fake_core(monkeypatch):
    """Route the MCP's HTTP calls to a fake hotel core; records the requests it gets."""
    seen = []
    routes = {
        "/api/calls/c1": {"id": "c1", "transcript": "hi", "messages": [{"role": "user"}] * 50, "tool_calls": []},
        "/api/evals/7": {"id": 7, "results": [{"name": "a", "passed": True, "transcript": ["x"]},
                                              {"name": "b", "passed": False, "transcript": ["y"], "reason": "no"}]},
        "/api/payments": [{"booking_id": 1, "status": "open"}],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/api/versions/1/rollback":
            return httpx.Response(403, json={"detail": "owner only"})
        if request.url.path not in routes:
            return httpx.Response(404, json={"detail": "no such call"})
        return httpx.Response(200, json=routes[request.url.path])

    real = httpx.Client
    monkeypatch.setattr(doss_mcp.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setenv("DOSS_API_KEY", "doss-key")
    return seen


WRITES = {"mark_team_message_done", "run_danny_tests"}  # small writes: Hermes asks the owner in the chat


def test_only_the_small_writes_are_not_read_only():
    tools = asyncio.run(doss_mcp.mcp.list_tools())
    tools = getattr(tools, "tools", tools)
    writes = {t.name for t in tools if not (t.annotations and t.annotations.read_only_hint)}
    assert writes == WRITES


def test_requests_carry_dosss_key_and_drop_empty_params(fake_core):
    assert doss_mcp.list_payments(days=7, status="") == [{"booking_id": 1, "status": "open"}]
    req = fake_core[0]
    assert req.headers["x-dashboard-key"] == "doss-key"
    assert dict(req.url.params) == {"days": "7"}


def test_get_call_drops_the_duplicate_turn_list(fake_core):
    call = doss_mcp.get_call("c1")
    assert "messages" not in call and call["transcript"] == "hi"


def test_eval_run_keeps_failures_in_full_and_passes_by_name(fake_core):
    run = doss_mcp.get_eval_run(7)
    assert run["passed_names"] == ["a"]
    assert run["failed"][0]["reason"] == "no" and "results" not in run


def test_core_errors_become_readable_messages(fake_core):
    with pytest.raises(RuntimeError, match="hotel core 404 on /api/calls/missing"):
        doss_mcp.get_call("missing")
