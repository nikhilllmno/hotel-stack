import type { Tab } from "./agent-tab";

const LOADING_SEEN_WITHIN_MS = 1_500;

/**
 * Runs `start` (a navigation) and resolves when the tab finishes loading, or after `timeoutMs`.
 * If the tab never starts loading (same-page navigation) it resolves after a short grace period.
 */
export function navigateAndWait(tabId: number, start: () => Promise<unknown>, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let sawLoading = false;
    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timeout);
      clearTimeout(grace);
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const onUpdated = (id: number, info: { status?: string }) => {
      if (id !== tabId) return;
      if (info.status === "loading") sawLoading = true;
      if (info.status === "complete" && sawLoading) finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    const timeout = setTimeout(finish, timeoutMs);
    const grace = setTimeout(() => {
      if (!sawLoading) finish();
    }, LOADING_SEEN_WITHIN_MS);
    start().catch((e) => {
      cleanup();
      reject(e);
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** After an action: give a navigation a moment to start, then wait (max `maxMs`) until the tab is loaded again. */
export async function settle(tabId: number, maxMs = 3_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  await sleep(300);
  while (Date.now() < deadline && (await chrome.tabs.get(tabId)).status !== "complete") await sleep(100);
}

/** Wait (max `timeoutMs`) until a freshly created tab has loaded its page; returns the tab as it is then. */
export async function waitForLoad(tabId: number, timeoutMs = 15_000): Promise<Tab> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await sleep(150);
    const tab = (await chrome.tabs.get(tabId)) as Tab;
    if ((tab.status === "complete" && !tab.pendingUrl) || Date.now() > deadline) return tab;
  }
}
