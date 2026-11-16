/** The line the agent reads in front of every message the owner sends from the side panel. */
export type TabInfo = { id?: number; title?: string; url?: string; favIconUrl?: string };

const PREFIX = "[From the Hermes Chrome extension. Current tab: ";
const PREFIX_RE = /^\[From the Hermes Chrome extension\.[^\n]*\]\n*/;

const oneLine = (s: string) => s.replace(/\s+/g, " ").replace(/"/g, "'").trim();

export function contextLine(tab: TabInfo): string {
  return `${PREFIX}"${oneLine(tab.title ?? "")}" ${tab.url ?? ""}. Use the chrome tools to act in this browser.]`;
}

/** The message sent to Hermes: context line + blank line + text. `tab` null = the owner dropped the chip for this message. */
export function withContext(message: string, tab: TabInfo | null | undefined): string {
  return tab ? `${contextLine(tab)}\n\n${message}` : message;
}

/** Hides the context line when showing a stored user message. */
export function stripContext(text: string): string {
  return text.replace(PREFIX_RE, "");
}

/** New chats are titled `Chrome: <first 40 chars>`. */
export function chatTitle(message: string): string {
  return `Chrome: ${message.replace(/\s+/g, " ").trim().slice(0, 40)}`;
}
