import { DEFAULT_BRIDGE_URL, DEFAULT_HERMES_URL, SETTINGS_KEY, type Settings } from "../shared/protocol";

export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<Settings> | undefined;
  return { hermesUrl: DEFAULT_HERMES_URL, hermesKey: "", bridgeUrl: DEFAULT_BRIDGE_URL, bridgeToken: "", ...stored };
}
