import { APPROVALS_KEY, type ApprovalView } from "../shared/approvals-view";
import type { ActArgs } from "../shared/protocol";
import type { ElementFacts } from "./risk";

/**
 * Single-use approvals. When `act` stops at needs_approval it files a record here and returns its id. The owner's
 * approval then arrives as `act_with_approval` with that id, and the action runs only if the tab, the document, the
 * snapshot, the arguments and the element are still exactly what was shown. Any difference gets a new id instead.
 */

export const APPROVAL_TTL_MS = 10 * 60 * 1000;
const MAX_RECORDS = 50;
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** What the side panel reads (id, expiresAt, summary, pageUrl) plus what the extension checks before it acts. */
export type Approval = ApprovalView & {
  tabId: number;
  docNonce: string;
  generation: number;
  href: string;          // location.href when the owner was asked: a same-document route change voids the approval
  args: string;          // canonicalArgs
  facts: string[];       // factsKey of every element that was judged
  option: string;        // select: JSON of [identity, label, value] of the option that would be chosen, else ""
  elementIds: string[];  // opaque document-local identity of every element that was judged (page.ts), in the same order
};

export type Binding = Omit<Approval, "id" | "expiresAt">;

let records: Map<string, Approval> | undefined;

async function load(): Promise<Map<string, Approval>> {
  if (records) return records;
  records = new Map();
  try {
    const stored = (await chrome.storage.session.get(APPROVALS_KEY))[APPROVALS_KEY] as Approval[] | undefined;
    for (const a of stored ?? []) records.set(a.id, a);
  } catch {
    // Without session storage the records live in memory only: a worker restart loses them and the owner asks again.
  }
  return records;
}

async function save(map: Map<string, Approval>): Promise<void> {
  try {
    await chrome.storage.session.set({ [APPROVALS_KEY]: [...map.values()] });
  } catch {
    // see load()
  }
}

function prune(map: Map<string, Approval>): void {
  const now = Date.now();
  for (const [id, a] of map) if (a.expiresAt <= now) map.delete(id);
  while (map.size > MAX_RECORDS) map.delete(map.keys().next().value as string);
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return "ap_" + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export async function createApproval(binding: Binding): Promise<string> {
  const map = await load();
  const id = newId();
  map.set(id, { ...binding, id, expiresAt: Date.now() + APPROVAL_TTL_MS });
  prune(map);
  await save(map);
  return id;
}

/** Returns the record for a known, unexpired id. The record is deleted either way: an id works once. */
export async function takeApproval(id: string | undefined): Promise<Approval | undefined> {
  const map = await load();
  const found = id ? map.get(id) : undefined;
  if (id) map.delete(id);
  prune(map);
  await save(map);
  return found && found.expiresAt > Date.now() ? found : undefined;
}

/** The arguments an approval covers. `reason` and `approval_id` are not part of the action. */
export function canonicalArgs(a: ActArgs): string {
  const picked: Record<string, unknown> = {
    action: a.action,
    ref: a.ref,
    x: a.x,
    y: a.y,
    text: a.text,
    clear: a.action === "type" ? a.clear !== false : undefined,
    key: a.key,
    direction: a.direction,
    amount: a.amount,
  };
  const sorted = Object.keys(picked).sort().filter((k) => picked[k] !== undefined);
  return JSON.stringify(sorted.map((k) => [k, picked[k]]));
}

/** What describes an element: if any of it changes, the owner approved something else. Identity itself is the element id. */
export function factsKey(f: ElementFacts): string {
  return JSON.stringify([f.tag, f.type, f.role, f.name, f.text, f.formAction, f.formMethod, f.activationUrl, f.inForm, f.fieldName, f.fieldId]);
}

/** Test hook: forget the in-memory copy so the next call reloads from storage. */
export function resetApprovalsForTest(): void {
  records = undefined;
}
