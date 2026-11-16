import { getWorkableTab } from "../agent-tab";
import { CommandError } from "../errors";
import { callPage } from "../page-call";
import { sleep } from "../tab-load";
import type { CommandOutput } from "./types";

const MAX_MS = 10_000;
const MAX_TEXT_TIMEOUT_MS = 30_000;
const POLL_MS = 250;

export async function wait(args: { ms?: number; text?: string; timeout_ms?: number }): Promise<CommandOutput> {
  if (args.text) return waitForText(args.text, Math.min(args.timeout_ms ?? 10_000, MAX_TEXT_TIMEOUT_MS));
  if (args.ms === undefined) throw new CommandError("wait needs ms (up to 10000) or text to wait for.");
  const ms = Math.min(Math.max(args.ms, 0), MAX_MS);
  await sleep(ms);
  return { text: `Waited ${ms} ms.` };
}

async function waitForText(text: string, timeoutMs: number): Promise<CommandOutput> {
  const needle = text.toLowerCase();
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    const tab = await getWorkableTab();
    // While a page is loading the scripting call can fail; the next poll tries again.
    const body = await callPage(tab, { op: "text" }).catch(() => "");
    if (body.toLowerCase().includes(needle)) return { text: `Text "${text}" is on the page after ${((Date.now() - start) / 1000).toFixed(1)} s.` };
    await sleep(POLL_MS);
  }
  throw new CommandError(`"${text}" did not appear within ${timeoutMs / 1000} s. Take a snapshot to see what the page shows.`);
}
