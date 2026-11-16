import { CommandError } from "./errors";

const RESTRICTED = /^(chrome|chrome-extension|chrome-untrusted|chrome-search|devtools|edge|about|view-source):/i;
const WEB_STORE = /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i;

const hint = "Use navigate to open a normal web page in this tab, or use_tab with a url to open a new tab.";

/** The error for a page Chrome does not let extensions read or control, or undefined if the page is workable. */
export function restrictedPageError(url: string | undefined): CommandError | undefined {
  if (!url) return new CommandError(`This tab has no address yet. ${hint}`);
  if (/^chrome-error:/i.test(url)) return new CommandError(`Chrome could not load this page (it shows an error page). Try navigate again or a different URL.`);
  if (RESTRICTED.test(url) || WEB_STORE.test(url)) {
    return new CommandError(`Chrome does not let extensions work on this page (${url}). ${hint}`);
  }
  return undefined;
}

/** Maps Chrome's own "Cannot access ..." failures from scripting and the debugger to the same actionable sentence. */
export function accessError(message: string, url: string | undefined): CommandError | undefined {
  if (!/cannot access|cannot be scripted|not allowed/i.test(message)) return undefined;
  const fileHint = url?.startsWith("file:") ? " For a local file the owner must turn on 'Allow access to file URLs' for Hermes at chrome://extensions." : "";
  return new CommandError(`Chrome does not let extensions work on this page (${url ?? "unknown address"}).${fileHint} ${hint}`);
}
