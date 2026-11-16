/**
 * Wire contract between the extension and the chrome bridge (chrome-extension/bridge, an MCP server that Hermes runs).
 * Hermes calls a bridge tool -> the bridge sends a `command` over the WebSocket -> the service worker runs it in Chrome
 * -> it answers with a `result`. The Python side mirrors these shapes in chrome_bridge/protocol.py: change both together.
 */

export const PROTOCOL_VERSION = 1;

/** Bridge tool names. Every one is readOnlyHint=true except `act_with_approval`, which Hermes asks the owner about. */
export type CommandName =
  | "tabs"              // list open tabs
  | "use_tab"           // pick the tab the agent works in, or open a new one
  | "navigate"          // go to a URL, back, forward, reload
  | "snapshot"          // url, title, numbered interactive elements (refs) and visible text
  | "screenshot"        // PNG of the agent tab's viewport
  | "act"               // click / type / press / scroll / select / hover; risky ones come back as needs_approval
  | "act_with_approval" // the same action, after the owner approved in Hermes (args.reason, args.approval_id)
  | "wait";             // wait for time or for text to appear

export type ActArgs = {
  action: "click" | "type" | "press" | "scroll" | "select" | "hover";
  ref?: string;          // element ref from the last snapshot, e.g. "e12"
  x?: number; y?: number; // viewport CSS pixels, for pages without usable refs (canvas, maps)
  text?: string;         // type: text to enter; select: option label or value
  clear?: boolean;       // type: replace the field's current value (default true)
  key?: string;          // press: "Enter", "Tab", "Escape", "ArrowDown", "Control+A" ...
  direction?: "up" | "down" | "left" | "right"; // scroll
  amount?: number;       // scroll: pixels (default one screen)
  reason?: string;       // act_with_approval only: shown to the owner
  approval_id?: string;  // act_with_approval only: the id the needs_approval result of `act` gave (single use)
};

export type CommandArgs = {
  tabs: Record<string, never>;
  use_tab: { tab_id?: number; url?: string };       // tab_id: adopt that tab; url: open a new tab in the Hermes group
  navigate: { url?: string; to?: "back" | "forward" | "reload" };
  snapshot: { max_text?: number };                   // characters of visible text (default 6000)
  screenshot: Record<string, never>;
  act: ActArgs;
  act_with_approval: ActArgs;
  wait: { ms?: number; text?: string; timeout_ms?: number };
};

/** bridge -> extension */
export type CommandMessage = {
  type: "command";
  id: string;
  name: CommandName;
  args: Record<string, unknown>;
  approved: boolean; // true only for act_with_approval: Hermes already asked the owner
};

/**
 * extension -> bridge. `text` is what the model reads. `image` (screenshot only) is attached as MCP ImageContent.
 * ok=false means the command failed; `error` is a sentence the agent can act on.
 * A risky `act` is NOT an error: ok=true, status "needs_approval", text tells the agent to call act_with_approval
 * with the same arguments, a reason, and the `approval_id` the text gives. The extension binds that id to the tab,
 * document, snapshot, target element and arguments; it is single use and expires after 10 minutes. If anything
 * changed, act_with_approval does nothing and returns needs_approval again with a new id.
 * A blocked action (password or payment-card field, javascript: URL) is ok=true, status "blocked": never approvable.
 */
export type ResultMessage = {
  type: "result";
  id: string;
  ok: boolean;
  status?: "done" | "needs_approval" | "blocked";
  text?: string;
  image?: { data: string; mime: "image/png" | "image/jpeg" };
  error?: string;
};

/** extension -> bridge, first message after the socket opens. */
export type HelloMessage = { type: "hello"; protocol: number; extension_version: string; user_agent: string };

/** Either side; the extension sends a ping every 20 s, which also keeps the MV3 service worker alive. */
export type PingMessage = { type: "ping" } | { type: "pong" };

export type BridgeToExtension = CommandMessage | PingMessage;
export type ExtensionToBridge = ResultMessage | HelloMessage | PingMessage;

/** Connection: ws://127.0.0.1:<port>/?token=<token>. The bridge refuses a bad token or an Origin that is not chrome-extension://. */
export const DEFAULT_BRIDGE_URL = "ws://127.0.0.1:8765";
export const DEFAULT_HERMES_URL = "http://127.0.0.1:8642";

/** chrome.storage.local keys, shared by the service worker and the side panel. */
export type Settings = {
  hermesUrl: string;    // Hermes API server base URL
  hermesKey: string;    // API_SERVER_KEY from the Hermes profile .env
  bridgeUrl: string;
  bridgeToken: string;  // CHROME_BRIDGE_TOKEN from the Hermes profile .env
};
export const SETTINGS_KEY = "settings";

/** Status the service worker publishes for the side panel (chrome.storage.session key "status"). */
export type BridgeStatus = {
  bridge: "disconnected" | "connecting" | "connected" | "unauthorized";
  agentTabId?: number;
  agentTabTitle?: string;
  lastAction?: { name: CommandName; summary: string; status: ResultMessage["status"] | "error"; at: number };
};
export const STATUS_KEY = "status";
