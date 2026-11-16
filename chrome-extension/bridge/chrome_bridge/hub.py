"""The WebSocket end the extension connects to. Holds the one live extension connection and its pending commands."""

import asyncio
import hmac
import json
import logging
import uuid
from http import HTTPStatus
from typing import Any
from urllib.parse import parse_qs, urlsplit

from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Request, Response

from chrome_bridge.protocol import PROTOCOL_VERSION, CommandName, Result, command

log = logging.getLogger("chrome_bridge")

MAX_MESSAGE_BYTES = 16 * 1024 * 1024  # screenshots; the extension keeps base64 images under 8 MB

NOT_CONNECTED = "Chrome is not connected. Ask the owner to open the Hermes side panel in Chrome."


class BridgeError(Exception):
    """A failure the agent can read and act on."""


class ExtensionHub:
    def __init__(self, token: str, host: str = "127.0.0.1", port: int = 8765):
        self.token = token
        self.host = host
        self.port = port
        self.conn: ServerConnection | None = None
        self.pending: dict[str, asyncio.Future[Result]] = {}
        self.server: Server | None = None
        self.start_error = ""

    async def start(self) -> None:
        """Listen for the extension. A busy port is reported to the agent on each call, not raised."""
        if not self.token:
            self.start_error = "CHROME_BRIDGE_TOKEN is not set in the Hermes profile .env, so the bridge refuses Chrome."
            log.error(self.start_error)
        try:
            self.server = await serve(self._handle, self.host, self.port, process_request=self._authorize,
                                      max_size=MAX_MESSAGE_BYTES)
            log.info("chrome bridge listening on ws://%s:%s", self.host, self.port)
        except OSError as exc:
            self.start_error = f"The chrome bridge could not listen on {self.host}:{self.port} ({exc.strerror}). Another bridge may already be running."
            log.error(self.start_error)

    async def stop(self) -> None:
        if self.server:
            self.server.close()
            await self.server.wait_closed()

    def _authorize(self, connection: ServerConnection, request: Request) -> Response | None:
        origin = request.headers.get("Origin", "")
        token = parse_qs(urlsplit(request.path).query).get("token", [""])[0]
        if not origin.startswith("chrome-extension://"):
            log.warning("refused a connection from origin %r", origin)
            return connection.respond(HTTPStatus.FORBIDDEN, "Only the Hermes Chrome extension may connect.\n")
        if not self.token or not hmac.compare_digest(token.encode(), self.token.encode()):
            log.warning("refused a connection with a wrong token")
            return connection.respond(HTTPStatus.UNAUTHORIZED, "Wrong bridge token.\n")
        return None

    async def _handle(self, conn: ServerConnection) -> None:
        if self.conn is not None:
            log.info("a new extension connection replaces the old one")
            await self.conn.close(code=4000, reason="replaced")
        self.conn = conn
        try:
            async for raw in conn:
                await self._on_message(conn, json.loads(raw))
        except ConnectionClosed:
            pass
        finally:
            if self.conn is conn:
                self.conn = None
                self._fail_pending("Chrome disconnected before the command finished.")

    async def _on_message(self, conn: ServerConnection, msg: dict[str, Any]) -> None:
        kind = msg.get("type")
        if kind == "ping":
            await conn.send(json.dumps({"type": "pong"}))
        elif kind == "hello":
            if msg.get("protocol") != PROTOCOL_VERSION:
                log.warning("extension speaks protocol %s, bridge speaks %s", msg.get("protocol"), PROTOCOL_VERSION)
        elif kind == "result":
            fut = self.pending.pop(str(msg.get("id")), None)
            if fut and not fut.done():
                fut.set_result(Result.from_message(msg))

    def _fail_pending(self, reason: str) -> None:
        for fut in self.pending.values():
            if not fut.done():
                fut.set_exception(BridgeError(reason))
        self.pending.clear()

    async def call(self, name: CommandName, args: dict[str, Any], timeout: float = 60.0) -> Result:
        """Send one command to the extension and wait for its result."""
        if self.start_error:
            raise BridgeError(self.start_error)
        conn = self.conn
        if conn is None:
            raise BridgeError(NOT_CONNECTED)
        id = uuid.uuid4().hex
        fut: asyncio.Future[Result] = asyncio.get_running_loop().create_future()
        self.pending[id] = fut
        try:
            await conn.send(json.dumps(command(id, name, args)))
            return await asyncio.wait_for(fut, timeout)
        except ConnectionClosed as exc:
            raise BridgeError(NOT_CONNECTED) from exc
        except TimeoutError as exc:
            raise BridgeError(f"Chrome did not finish '{name}' within {timeout:.0f} s. Take a snapshot to see the page now.") from exc
        finally:
            self.pending.pop(id, None)
