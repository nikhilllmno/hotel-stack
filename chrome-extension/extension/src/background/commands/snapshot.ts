import { getWorkableTab } from "../agent-tab";
import { callPage } from "../page-call";
import type { SnapshotData, SnapshotElement } from "../page";
import { isSensitiveField } from "../risk";
import type { CommandOutput } from "./types";

const DEFAULT_MAX_TEXT = 6000;

const quoted = (s: string) => `"${s.replace(/"/g, "'")}"`;

function elementLine(e: SnapshotElement): string {
  const { facts } = e;
  const parts = [`[${e.ref}] ${facts.role}`];
  if (facts.name) parts.push(quoted(facts.name));
  if (isSensitiveField(facts)) parts.push("(password, one-time-code or card field: Hermes never types here, ask the owner)");
  else if (e.value) parts.push(`value=${quoted(e.value.length > 80 ? e.value.slice(0, 79) + "…" : e.value)}`);
  if (e.href) parts.push(`-> ${e.href}`);
  if (e.disabled) parts.push("(disabled)");
  if (e.checked) parts.push("(checked)");
  if (facts.inForm) parts.push("(in form)");
  return parts.join(" ");
}

/** The text the model reads for a page snapshot. */
export function formatSnapshot(d: SnapshotData): string {
  const lines = [
    `Page: ${quoted(d.title)}`,
    `URL: ${d.url}`,
    `Scroll: ${d.scrollY} of ${d.pageHeight} px down (viewport ${d.viewport.width}x${d.viewport.height})`,
  ];
  if (d.iframes) lines.push(`Only the top frame is shown: the content of ${d.iframes} iframe(s) is not included.`);
  lines.push(`Elements (${d.total}):`);
  lines.push(...(d.elements.length ? d.elements.map(elementLine) : ["(no interactive elements)"]));
  if (d.total > d.elements.length) lines.push(`Only the first ${d.elements.length} of ${d.total} elements are listed.`);
  lines.push("", "Visible text:", d.text || "(none)");
  if (d.textLeft) lines.push(`… ${d.textLeft} more characters; call snapshot with a larger max_text to read them.`);
  return lines.join("\n");
}

export async function snapshot(args: { max_text?: number }): Promise<CommandOutput> {
  const tab = await getWorkableTab();
  const maxText = Math.max(0, Math.floor(args.max_text ?? DEFAULT_MAX_TEXT));
  return { text: formatSnapshot(await callPage(tab, { op: "snapshot", maxText })) };
}
