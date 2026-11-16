import type { Tab } from "./agent-tab";
import { CommandError, errorMessage } from "./errors";
import { hermesPage, type PageRequest, type PageResult } from "./page";
import { accessError } from "./restricted";

/** Run one in-page operation in the tab's ISOLATED world (it keeps the element refs between calls). */
export async function callPage<R extends PageRequest>(tab: Tab, req: R): Promise<PageResult<R>> {
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "ISOLATED", func: hermesPage, args: [req] });
    return injection.result as PageResult<R>;
  } catch (e) {
    const message = errorMessage(e);
    throw accessError(message, tab.url) ?? new CommandError(`Could not read the page (${message}). Take a new snapshot or reload the tab.`);
  }
}
