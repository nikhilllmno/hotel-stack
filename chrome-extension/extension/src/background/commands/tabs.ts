import { adoptTab, type Tab } from "../agent-tab";
import { CommandError } from "../errors";
import { classifyUrl } from "../risk";
import { getStatus } from "../status";
import { waitForLoad } from "../tab-load";
import { withScheme } from "./page-line";
import type { CommandOutput } from "./types";

const tabLine = (t: chrome.tabs.Tab, agentId: number | undefined, activeIds: Set<number | undefined>) =>
  `[tab ${t.id}] "${t.title ?? ""}" ${t.url ?? ""}${activeIds.has(t.id) ? " (active)" : ""}${t.id === agentId ? " [agent]" : ""}`;

export async function tabs(): Promise<CommandOutput> {
  const [all, active, status] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
    getStatus(),
  ]);
  const activeIds = new Set(active.map((t) => t.id));
  const lines = all.map((t) => tabLine(t, status.agentTabId, activeIds));
  return { text: lines.length ? lines.join("\n") : "Chrome has no open tabs." };
}

const describe = (t: chrome.tabs.Tab) => `[tab ${t.id}] "${t.title ?? ""}" ${t.url ?? ""}`;

export async function useTab(args: { tab_id?: number; url?: string }): Promise<CommandOutput> {
  if (args.tab_id !== undefined) {
    const tab = await chrome.tabs.get(args.tab_id).catch(() => undefined);
    if (!tab) throw new CommandError(`There is no tab with id ${args.tab_id}. Call tabs to see the open tabs.`);
    await chrome.tabs.update(args.tab_id, { active: true });
    await adoptTab(tab as Tab);
    return { text: `Now working in ${describe(tab)}.` };
  }
  if (!args.url) throw new CommandError("use_tab needs tab_id (a tab from tabs) or url (to open a new tab).");
  const url = withScheme(args.url);
  const risk = classifyUrl(url);
  if (risk.level === "blocked") return { status: "blocked", text: risk.reason };
  const created = await chrome.tabs.create({ url, active: true });
  const tab = await waitForLoad(created.id as number);
  await adoptTab(tab);
  return { text: `Opened and now working in ${describe(tab)}.` };
}
