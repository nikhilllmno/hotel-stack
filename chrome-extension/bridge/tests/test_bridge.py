"""Bridge behaviour against a fake extension: auth, command round trip, timeouts, tool hints and errors."""

import asyncio
import base64
import json

import pytest
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.mcpserver.utilities.types import Image
from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

from chrome_bridge import server
from chrome_bridge.hub import NOT_CONNECTED, BridgeError, ExtensionHub

TOKEN = "s3cret"
ORIGIN = "chrome-extension://hcedflknbknnjccddacdljlcfgocghod"


@pytest.fixture
async def hub(monkeypatch):
    h = ExtensionHub(token=TOKEN, port=0)
    await h.start()
    h.port = h.server.sockets[0].getsockname()[1]
    monkeypatch.setattr(server, "hub", h)
    yield h
    await h.stop()


def url(hub: ExtensionHub, token: str = TOKEN) -> str:
    return f"ws://127.0.0.1:{hub.port}/?token={token}"


async def fake_extension(hub: ExtensionHub, answer):
    """Connect like the extension and answer each command with answer(command) until cancelled."""
    ws = await connect(url(hub), origin=ORIGIN)
    await ws.send(json.dumps({"type": "hello", "protocol": 1, "extension_version": "0.1.0", "user_agent": "test"}))

    async def loop():
        async for raw in ws:
            msg = json.loads(raw)
            if msg["type"] == "command":
                reply = answer(msg)
                if reply is not None:
                    await ws.send(json.dumps({"type": "result", "id": msg["id"], **reply}))

    task = asyncio.create_task(loop())
    while hub.conn is None:
        await asyncio.sleep(0.01)
    return ws, task


async def test_refuses_web_page_origin(hub):
    with pytest.raises(InvalidStatus) as exc:
        await connect(url(hub), origin="https://evil.example")
    assert exc.value.response.status_code == 403


async def test_refuses_wrong_token(hub):
    with pytest.raises(InvalidStatus) as exc:
        await connect(url(hub, "nope"), origin=ORIGIN)
    assert exc.value.response.status_code == 401


async def test_refuses_everyone_without_configured_token(monkeypatch):
    h = ExtensionHub(token="", port=0)
    await h.start()
    port = h.server.sockets[0].getsockname()[1]
    try:
        with pytest.raises(InvalidStatus):
            await connect(f"ws://127.0.0.1:{port}/?token=", origin=ORIGIN)
        with pytest.raises(BridgeError, match="CHROME_BRIDGE_TOKEN"):
            await h.call("tabs", {})
    finally:
        await h.stop()


async def test_not_connected_is_a_readable_error(hub):
    with pytest.raises(ToolError, match="Chrome is not connected"):
        await server.tabs()
    assert "side panel" in NOT_CONNECTED


async def test_ping_gets_pong(hub):
    async with connect(url(hub), origin=ORIGIN) as ws:
        await ws.send(json.dumps({"type": "ping"}))
        assert json.loads(await ws.recv()) == {"type": "pong"}


async def test_round_trip_and_approved_flag(hub):
    seen = []

    def answer(cmd):
        seen.append(cmd)
        return {"ok": True, "status": "done", "text": f"did {cmd['name']}"}

    ws, task = await fake_extension(hub, answer)
    assert await server.act(action="click", ref="e3") == "did act"
    assert await server.act_with_approval(approval_id="ap1", reason="Submit the form", action="click",
                                          ref="e9") == "did act_with_approval"
    assert seen[0]["approved"] is False
    assert seen[0]["args"] == {"action": "click", "ref": "e3"}  # None values are not sent
    assert seen[1]["approved"] is True and seen[1]["args"]["reason"] == "Submit the form"
    assert seen[1]["args"]["approval_id"] == "ap1"
    task.cancel()
    await ws.close()


async def test_needs_approval_is_text_not_error(hub):
    text = "Not done: this click needs the owner's approval (submits a form: \"Pay now\")."
    ws, task = await fake_extension(hub, lambda c: {"ok": True, "status": "needs_approval", "text": text})
    assert await server.act(action="click", ref="e1") == text
    task.cancel()
    await ws.close()


async def test_extension_error_becomes_tool_error(hub):
    ws, task = await fake_extension(hub, lambda c: {"ok": False, "error": "Element e12 is gone. Take a new snapshot."})
    with pytest.raises(ToolError, match="e12 is gone"):
        await server.act(action="click", ref="e12")
    task.cancel()
    await ws.close()


async def test_screenshot_returns_image(hub):
    png = base64.b64encode(b"\x89PNG fake").decode()
    ws, task = await fake_extension(hub, lambda c: {"ok": True, "status": "done", "text": "Viewport 1280x720",
                                                    "image": {"data": png, "mime": "image/png"}})
    image, caption = await server.screenshot()
    assert isinstance(image, Image) and image.data == b"\x89PNG fake"
    assert caption == "Viewport 1280x720"
    task.cancel()
    await ws.close()


async def test_timeout(hub):
    ws, task = await fake_extension(hub, lambda c: None)  # never answers
    with pytest.raises(BridgeError, match="did not finish 'tabs'"):
        await hub.call("tabs", {}, timeout=0.2)
    assert hub.pending == {}
    task.cancel()
    await ws.close()


async def test_disconnect_fails_pending_command(hub):
    ws, task = await fake_extension(hub, lambda c: None)
    call = asyncio.create_task(hub.call("snapshot", {}, timeout=5))
    await asyncio.sleep(0.05)
    await ws.close()
    with pytest.raises(BridgeError, match="disconnected"):
        await call
    task.cancel()


async def test_new_connection_replaces_old(hub):
    first = await connect(url(hub), origin=ORIGIN)
    while hub.conn is None:
        await asyncio.sleep(0.01)
    old = hub.conn
    second = await connect(url(hub), origin=ORIGIN)
    while hub.conn is old:
        await asyncio.sleep(0.01)
    await first.wait_closed()
    assert first.close_code == 4000
    await second.close()


async def test_argument_checks_before_sending(hub):
    with pytest.raises(ToolError, match="needs a ref"):
        await server.act(action="click")
    with pytest.raises(ToolError, match="needs text"):
        await server.act(action="type", ref="e1")
    with pytest.raises(ToolError, match="needs key"):
        await server.act(action="press")
    with pytest.raises(ToolError, match="not x and y"):
        await server.act(action="press", key="Enter", x=10, y=10)
    with pytest.raises(ToolError, match="approval_id"):
        await server.act_with_approval(approval_id=" ", reason="Save", action="click", ref="e1")
    with pytest.raises(ToolError, match="reason"):
        await server.act_with_approval(approval_id="ap1", reason="", action="click", ref="e1")
    with pytest.raises(ToolError, match="under 200"):
        await server.act_with_approval(approval_id="ap1", reason="x" * 201, action="click", ref="e1")


async def test_only_act_with_approval_asks_the_owner():
    tools = {t.name: t for t in await server.mcp.list_tools()}
    assert set(tools) == {"tabs", "use_tab", "navigate", "snapshot", "screenshot", "act", "act_with_approval", "wait"}
    for name, tool in tools.items():
        assert tool.annotations.read_only_hint is (name != "act_with_approval"), name
    schema = tools["act_with_approval"].input_schema
    assert {"reason", "approval_id"} <= set(schema["required"])
    assert list(schema["properties"])[0] == "approval_id"  # first, so Hermes' 1200-char cut never hides it


async def test_large_screenshot_fits_in_one_message(hub):
    big = base64.b64encode(b"\x89PNG" + b"x" * (3 * 1024 * 1024)).decode()  # about 4 MB of base64, over the 1 MiB default
    ws, task = await fake_extension(hub, lambda c: {"ok": True, "status": "done", "text": "big",
                                                    "image": {"data": big, "mime": "image/png"}})
    image, caption = await server.screenshot()
    assert len(image.data) == 4 + 3 * 1024 * 1024 and caption == "big"
    task.cancel()
    await ws.close()
