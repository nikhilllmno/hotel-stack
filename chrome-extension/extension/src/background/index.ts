// Service worker entry: opens the side panel, keeps the bridge connection alive and runs the commands it receives.
import { watchAgentTab } from "./agent-tab";
import { BridgeClient } from "./bridge";
import { watchDebuggerDetach } from "./debugger";
import { runCommand } from "./dispatch";
import { loadSettings } from "./settings";
import { updateStatus } from "./status";
import { SETTINGS_KEY } from "../shared/protocol";

const ALARM = "hermes-bridge-wakeup";

const bridge = new BridgeClient({
  loadSettings,
  openSocket: (url) => new WebSocket(url),
  probeHttpStatus: (url) => fetch(url).then((r) => r.status, () => undefined),
  runCommand,
  setBridgeState: (bridge) => updateStatus({ bridge }),
  hello: () => ({ extension_version: chrome.runtime.getManifest().version, user_agent: navigator.userAgent }),
});

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
watchDebuggerDetach();
watchAgentTab();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && SETTINGS_KEY in changes) void bridge.reconnect();
});
// MV3 may stop this worker at any time; the alarm wakes it and reconnects.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void bridge.ensureConnected();
});
void chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });

// A fresh worker starts with no socket, whatever status the previous one left behind.
void updateStatus({ bridge: "disconnected" }).then(() => bridge.ensureConnected());
