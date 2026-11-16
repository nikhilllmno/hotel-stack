import { DEFAULT_BRIDGE_URL, DEFAULT_HERMES_URL, SETTINGS_KEY, STATUS_KEY, type BridgeStatus, type Settings } from "../shared/protocol";

export const DEFAULT_SETTINGS: Settings = { hermesUrl: DEFAULT_HERMES_URL, hermesKey: "", bridgeUrl: DEFAULT_BRIDGE_URL, bridgeToken: "" };

/** The side panel opens Settings first until the Hermes key and the bridge token are set. */
export const isConfigured = (s: Settings) => Boolean(s.hermesKey.trim() && s.bridgeToken.trim());

export async function loadSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(r[SETTINGS_KEY] as Partial<Settings> | undefined) };
}

export async function saveSettings(s: Settings): Promise<void> {
  const clean: Settings = {
    hermesUrl: s.hermesUrl.trim() || DEFAULT_SETTINGS.hermesUrl, hermesKey: s.hermesKey.trim(),
    bridgeUrl: s.bridgeUrl.trim() || DEFAULT_SETTINGS.bridgeUrl, bridgeToken: s.bridgeToken.trim(),
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: clean });
}

export async function loadBridgeStatus(): Promise<BridgeStatus> {
  const r = await chrome.storage.session.get(STATUS_KEY);
  return (r[STATUS_KEY] as BridgeStatus | undefined) ?? { bridge: "disconnected" };
}
