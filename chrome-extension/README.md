# Hermes for Chrome

A Chrome side panel to chat with Doss (Hermes), which can work in your own Chrome tabs: read pages, click, type,
navigate and take screenshots, with your logins (Beds24, OTA extranets, email). Risky actions wait for your Approve.

```
Side panel  --HTTP + SSE-->  Hermes API server (127.0.0.1:8642)
                                   |  Doss calls the "chrome" MCP tools
                             chrome bridge (bridge/, started by Hermes)
                                   |  WebSocket ws://127.0.0.1:8765 (token)
Extension service worker  <--------+  runs each command in Chrome (chrome.debugger + chrome.scripting)
```

- `extension/`: the MV3 extension (Vite, React, Tailwind; tokens shared with the dashboard).
- `bridge/`: MCP server "chrome" (Python). Hermes runs it over stdio; it also listens for the extension.
- Wire contract: `extension/src/shared/protocol.ts` = `bridge/chrome_bridge/protocol.py`. Change both together.

## Set up (once)

1. Build the extension:
   ```bash
   cd chrome-extension/extension && pnpm install && pnpm build
   ```
2. In Chrome open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and pick
   `chrome-extension/extension/dist`. The extension ID is always `hcedflknbknnjccddacdljlcfgocghod`
   (fixed by the `key` in `public/manifest.json`).
3. Make a bridge token and add it to the Hermes profile secrets (`hotels/demo-hotel/.env`):
   ```bash
   echo "CHROME_BRIDGE_TOKEN=$(openssl rand -hex 24)" >> hotels/demo-hotel/.env
   ```
4. The profile config (`hotels/demo-hotel/config.yaml`) already has:
   - `mcp_servers.chrome`: starts the bridge with `CHROME_BRIDGE_TOKEN`.
   - `gateway.api_server.cors_origins: chrome-extension://hcedflknbknnjccddacdljlcfgocghod`: without it Hermes
     answers 403 to the side panel.
   Restart the Hermes gateway (`source env.sh && hermes gateway restart`) so it loads both.
5. Click the extension icon. The side panel opens on Settings. Enter:
   - Hermes URL: `http://127.0.0.1:8642`
   - Hermes API key: `API_SERVER_KEY` from `hotels/demo-hotel/.env`
   - Bridge URL: `ws://127.0.0.1:8765`
   - Bridge token: the `CHROME_BRIDGE_TOKEN` from step 3
   Click "Test connection": both "Hermes" and "Chrome" must show connected.

## Use

Open the side panel on any page and ask, for example "Summarise this page" or "Open the Booking.com extranet and
check Saturday's rate for Cabin 2". Each message tells Doss which tab you are on. Doss works in that tab, or opens new
tabs in a "Hermes" tab group. Chrome shows "Hermes for Chrome started debugging this browser" while it acts: that is
expected. Close the bar or press Stop in the panel to take control back.

What needs your approval: submitting forms, saving, paying, booking, sending, deleting, cancelling, confirming. Doss
asks with Approve / Deny in the panel. Reading, scrolling, navigating and normal clicks run without asking.
Passwords, one-time codes and card details are never typed by Doss: you type them.

## Develop

```bash
cd chrome-extension/extension && pnpm dev        # rebuilds dist/ on save; click reload on chrome://extensions
pnpm typecheck && pnpm test && pnpm build
cd ../bridge && uv run pytest
```
Bridge logs go to the Hermes gateway's MCP log. The service worker log: `chrome://extensions` -> "service worker".
