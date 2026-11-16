import json

import httpx

from hotelcore import vapi_live


def mock_vapi(monkeypatch, status: str) -> list:
    """Vapi returns a call with the given status; records what is posted to the control URL."""
    posted = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json={"id": "c1", "status": status, "monitor": {"controlUrl": "https://ctl.test/c1/control"}})
        posted.append(json.loads(request.content))
        return httpx.Response(200, json={"status": "ok"})

    real_client = httpx.Client
    monkeypatch.setenv("VAPI_API_KEY", "k")
    monkeypatch.setattr(vapi_live.httpx, "Client", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(vapi_live.httpx, "post", lambda url, **kw: real_client(transport=httpx.MockTransport(handler)).post(url, **kw))
    return posted


def test_live_call_gets_payment_note(monkeypatch):
    posted = mock_vapi(monkeypatch, "in-progress")
    assert vapi_live.tell_live_call("c1", "Payment update: paid") is True
    assert posted == [{"type": "add-message", "triggerResponseEnabled": True, "message": {"role": "system", "content": "Payment update: paid"}}]


def test_ended_call_is_not_told(monkeypatch):
    posted = mock_vapi(monkeypatch, "ended")
    assert vapi_live.tell_live_call("c1", "Payment update: paid") is False and posted == []
