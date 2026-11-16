# chrome bridge

MCP server "chrome" for Hermes. It relays tool calls to the Hermes for Chrome extension over a local WebSocket.
Setup and architecture: `../README.md`.

```bash
uv run python -m chrome_bridge.server   # stdio MCP; Hermes starts it from mcp_servers.chrome
uv run pytest
```

Environment: `CHROME_BRIDGE_TOKEN` (required; the extension sends it), `CHROME_BRIDGE_PORT` (default 8765),
`CHROME_BRIDGE_HOST` (default 127.0.0.1).

Security: only `chrome-extension://` origins with the right token may connect, so a web page cannot drive the
browser through localhost. Every tool is `readOnlyHint=True` except `act_with_approval`; the extension refuses risky
actions through `act`, so they only run after the owner approves `act_with_approval` in the chat. `act` gives a
single-use `approval_id` that the extension binds to the tab, document, element and arguments, so an approval cannot
be reused for a different action or page. Messages may be up to 16 MiB (screenshots).
