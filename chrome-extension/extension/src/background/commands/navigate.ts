import { getAgentTab } from "../agent-tab";
import { CommandError, errorMessage } from "../errors";
import { classifyUrl } from "../risk";
import { navigateAndWait } from "../tab-load";
import { pageLine, withScheme } from "./page-line";
import type { CommandOutput } from "./types";

export async function navigate(args: { url?: string; to?: "back" | "forward" | "reload" }): Promise<CommandOutput> {
  const tab = await getAgentTab();
  let start: () => Promise<unknown>;
  let did: string;
  if (args.url) {
    const url = withScheme(args.url);
    const risk = classifyUrl(url);
    if (risk.level === "blocked") return { status: "blocked", text: risk.reason };
    start = () => chrome.tabs.update(tab.id, { url });
    did = `Opened ${url}.`;
  } else if (args.to === "reload") {
    start = () => chrome.tabs.reload(tab.id);
    did = "Reloaded the page.";
  } else if (args.to === "back" || args.to === "forward") {
    const go = args.to === "back" ? chrome.tabs.goBack : chrome.tabs.goForward;
    start = () =>
      go(tab.id).catch((e) => {
        throw new CommandError(`There is no ${args.to === "back" ? "earlier" : "later"} page in this tab's history (${errorMessage(e)}).`);
      });
    did = `Went ${args.to}.`;
  } else {
    throw new CommandError("navigate needs url, or to: back, forward or reload.");
  }
  await navigateAndWait(tab.id, start);
  return { text: `${did} ${await pageLine(tab.id)}` };
}
