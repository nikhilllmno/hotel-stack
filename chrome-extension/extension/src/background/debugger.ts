import { CommandError, errorMessage } from "./errors";
import { accessError } from "./restricted";

/** The tab to control: its URL is only used to word errors. */
export type Target = { id: number; url?: string };

const PROTOCOL = "1.3";
const IDLE_DETACH_MS = 5 * 60_000;

const attached = new Set<number>();
const idleTimers = new Map<number, ReturnType<typeof setTimeout>>();
/** Tabs where the owner pressed Cancel on Chrome's "is debugging this browser" bar. */
const cancelledByOwner = new Set<number>();

function forget(tabId: number): void {
  attached.delete(tabId);
  clearTimeout(idleTimers.get(tabId));
  idleTimers.delete(tabId);
}

/** Register once at service worker start. */
export function watchDebuggerDetach(): void {
  chrome.debugger.onDetach.addListener((source, reason) => {
    if (source.tabId === undefined) return;
    forget(source.tabId);
    if (reason === "canceled_by_user") cancelledByOwner.add(source.tabId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    forget(tabId);
    cancelledByOwner.delete(tabId);
  });
}

/** The owner changed their mind about the cancel: use_tab on the tab lets Hermes attach again. */
export function allowReattach(tabId: number): void {
  cancelledByOwner.delete(tabId);
}

function cancelledError(): CommandError {
  return new CommandError(
    "The owner stopped Hermes from controlling this tab (they clicked Cancel on Chrome's debugging bar). " +
      "Ask the owner before continuing; use_tab on the tab resumes control.",
  );
}

async function attach({ id: tabId, url }: Target): Promise<void> {
  if (cancelledByOwner.has(tabId)) throw cancelledError();
  if (attached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, PROTOCOL);
  } catch (e) {
    const message = errorMessage(e);
    // "Already attached" means a session from before a service worker restart: it is ours, reuse it.
    if (!/already attached/i.test(message)) {
      throw (
        accessError(message, url) ??
        new CommandError(`Chrome would not let Hermes control this tab (${message}). Close other debuggers on it or use another tab.`)
      );
    }
  }
  attached.add(tabId);
}

/** Send a CDP command to the tab, attaching the debugger on first use and detaching after 5 idle minutes. */
export async function cdp<T = unknown>(tab: Target, method: string, params?: Record<string, unknown>): Promise<T> {
  const tabId = tab.id;
  await attach(tab);
  clearTimeout(idleTimers.get(tabId));
  idleTimers.set(
    tabId,
    setTimeout(() => {
      forget(tabId);
      void chrome.debugger.detach({ tabId }).catch(() => undefined);
    }, IDLE_DETACH_MS),
  );
  try {
    return (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
  } catch (e) {
    if (cancelledByOwner.has(tabId)) throw cancelledError();
    throw new CommandError(`Chrome rejected ${method}: ${errorMessage(e)}`);
  }
}
