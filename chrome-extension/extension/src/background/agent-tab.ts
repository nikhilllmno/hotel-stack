import { allowReattach } from "./debugger";
import { CommandError } from "./errors";
import { restrictedPageError } from "./restricted";
import { getStatus, updateStatus } from "./status";

export type Tab = chrome.tabs.Tab & { id: number };

const GROUP_TITLE = "Hermes";

/** Keep the status the side panel shows in step with the tab Hermes works in. Register once at service worker start. */
export function watchAgentTab(): void {
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    if ((await getStatus()).agentTabId === tabId) await updateStatus({ agentTabId: undefined, agentTabTitle: undefined });
  });
  chrome.tabs.onUpdated.addListener(async (tabId, info) => {
    if (info.title !== undefined && (await getStatus()).agentTabId === tabId) await updateStatus({ agentTabTitle: info.title });
  });
}

async function joinHermesGroup(tab: Tab): Promise<void> {
  const [group] = await chrome.tabGroups.query({ title: GROUP_TITLE, windowId: tab.windowId });
  if (group && tab.groupId === group.id) return;
  const groupId = await chrome.tabs.group({ tabIds: tab.id, groupId: group?.id });
  if (!group) await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: "purple" });
}

/** Make `tab` the tab Hermes works in and put it in the "Hermes" tab group. */
export async function adoptTab(tab: Tab): Promise<void> {
  allowReattach(tab.id);
  await joinHermesGroup(tab);
  await updateStatus({ agentTabId: tab.id, agentTabTitle: tab.title });
}

async function defaultTab(): Promise<Tab> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs.find((t) => t.id !== undefined && !t.url?.startsWith("chrome-extension:")) as Tab | undefined;
  if (!tab) throw new CommandError("Chrome has no active tab to work in. Use use_tab with a url to open one.");
  await adoptTab(tab);
  return tab;
}

/** The tab Hermes works in: the one chosen with use_tab, else the owner's active tab (adopted on first use). */
export async function getAgentTab(): Promise<Tab> {
  const id = (await getStatus()).agentTabId;
  if (id !== undefined) {
    const tab = await chrome.tabs.get(id).catch(() => undefined);
    if (tab) return tab as Tab;
  }
  return defaultTab();
}

/** The agent tab, only if Chrome lets extensions read and control it. */
export async function getWorkableTab(): Promise<Tab> {
  const tab = await getAgentTab();
  const error = restrictedPageError(tab.url);
  if (error) throw error;
  return tab;
}
