import { loadBridgeStatus } from "../lib/settings";
import { STATUS_KEY, type BridgeStatus } from "../shared/protocol";

let current: BridgeStatus | undefined;
let writes: Promise<void> = Promise.resolve();

/** The BridgeStatus the side panel reads; kept in chrome.storage.session so it survives a service worker restart. */
export async function getStatus(): Promise<BridgeStatus> {
  current ??= await loadBridgeStatus();
  return current;
}

/** Merge `patch` into the status (a key set to undefined is cleared) and publish it. */
export function updateStatus(patch: Partial<BridgeStatus>): Promise<void> {
  writes = writes.then(async () => {
    current = { ...(await getStatus()), ...patch };
    await chrome.storage.session.set({ [STATUS_KEY]: current });
  });
  return writes;
}
