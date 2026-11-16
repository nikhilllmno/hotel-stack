import { beforeEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_TTL_MS, canonicalArgs, createApproval, factsKey, resetApprovalsForTest, takeApproval } from "../src/background/approvals";
import type { ElementFacts } from "../src/background/risk";
import { APPROVALS_KEY, readApproval } from "../src/shared/approvals-view";

const binding = { tabId: 1, docNonce: "n", generation: 1, href: "https://x.com/", args: "[]", facts: ["f"], elementIds: ["el1"], option: "", summary: 'Click button "Save"', pageUrl: "https://x.com/" };
let stored: Record<string, unknown>;

beforeEach(() => {
  stored = {};
  (globalThis as { chrome?: unknown }).chrome = {
    storage: { session: { get: async (k: string) => ({ [k]: stored[k] }), set: async (o: Record<string, unknown>) => void Object.assign(stored, o) } },
  };
  resetApprovalsForTest();
});

describe("approvals", () => {
  it("issues ap_ + 12 random characters", async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, () => createApproval(binding)));
    for (const id of ids) expect(id).toMatch(/^ap_[a-z2-9]{12}$/);
    expect(new Set(ids).size).toBe(20);
  });

  it("returns a record once and then forgets it", async () => {
    const id = await createApproval(binding);
    expect(await takeApproval(id)).toMatchObject({ id, tabId: 1, docNonce: "n", generation: 1 });
    expect(await takeApproval(id)).toBeUndefined();
  });

  it("returns nothing for a missing or unknown id", async () => {
    await createApproval(binding);
    expect(await takeApproval(undefined)).toBeUndefined();
    expect(await takeApproval("")).toBeUndefined();
    expect(await takeApproval("ap_nope")).toBeUndefined();
  });

  it("expires after 10 minutes and still deletes the record", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const id = await createApproval(binding);
      vi.setSystemTime(Date.now() + APPROVAL_TTL_MS);
      expect(await takeApproval(id)).toBeUndefined();
      expect(await takeApproval(id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("mirrors records to session storage so a worker restart keeps them, and clears used ones there", async () => {
    const id = await createApproval(binding);
    expect((stored["hermes-approvals"] as { id: string }[]).map((a) => a.id)).toEqual([id]);
    resetApprovalsForTest();
    expect(await takeApproval(id)).toBeDefined();
    expect(stored["hermes-approvals"]).toEqual([]);
  });

  it("keeps at most 50 records, dropping the oldest", async () => {
    const first = await createApproval(binding);
    for (let i = 0; i < 55; i++) await createApproval(binding);
    expect((stored["hermes-approvals"] as unknown[]).length).toBeLessThanOrEqual(50);
    expect(await takeApproval(first)).toBeUndefined();
  });

  it("files the record under the key the side panel reads, with summary and page url, and the side panel reads it back", async () => {
    expect(APPROVALS_KEY).toBe("hermes-approvals");
    const id = await createApproval(binding);
    expect(await readApproval(id)).toMatchObject({ id, summary: 'Click button "Save"', pageUrl: "https://x.com/", expiresAt: expect.any(Number) });
    expect(await readApproval("ap_nope")).toBeUndefined();
    await takeApproval(id);
    expect(await readApproval(id)).toBeUndefined();   // used: gone for the side panel too
  });

  it("the side panel does not see an expired record", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const id = await createApproval(binding);
      vi.setSystemTime(Date.now() + APPROVAL_TTL_MS);
      expect(await readApproval(id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("works in memory when session storage is not available", async () => {
    (globalThis as { chrome?: unknown }).chrome = {};
    resetApprovalsForTest();
    const id = await createApproval(binding);
    expect(await takeApproval(id)).toBeDefined();
  });
});

describe("canonicalArgs", () => {
  it("ignores reason and approval_id and key order, and keeps everything that changes the action", () => {
    const base = canonicalArgs({ action: "type", ref: "e1", text: "a" });
    expect(canonicalArgs({ text: "a", ref: "e1", action: "type", reason: "because", approval_id: "ap_x" })).toBe(base);
    expect(canonicalArgs({ action: "type", ref: "e1", text: "a", clear: true })).toBe(base);   // clear defaults to true
    for (const other of [{ text: "b" }, { ref: "e2" }, { clear: false }, { x: 1, y: 2 }]) {
      expect(canonicalArgs({ action: "type", ref: "e1", text: "a", ...other })).not.toBe(base);
    }
    expect(canonicalArgs({ action: "press", key: "Enter" })).not.toBe(canonicalArgs({ action: "press", key: "Shift+Enter" }));
    expect(canonicalArgs({ action: "scroll", direction: "up", amount: 5 })).not.toBe(canonicalArgs({ action: "scroll", direction: "up", amount: 6 }));
    expect(canonicalArgs({ action: "scroll", direction: "up" })).not.toBe(canonicalArgs({ action: "scroll", direction: "down" }));
  });
});

describe("factsKey", () => {
  const f: ElementFacts = { tag: "button", role: "button", name: "Pay", inForm: true, pageHost: "x.com", formAction: "/pay", formMethod: "post", activationUrl: "https://x.com/pay" };
  it("changes when the element's identity, wording or destination changes", () => {
    expect(factsKey({ ...f })).toBe(factsKey(f));
    for (const other of [{ name: "Delete" }, { text: "Delete" }, { formAction: "/x" }, { formMethod: "get" }, { activationUrl: "https://evil.test" }, { tag: "a" }, { fieldId: "z" }]) {
      expect(factsKey({ ...f, ...other })).not.toBe(factsKey(f));
    }
  });
});
