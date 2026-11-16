import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ElementFacts } from "../src/background/risk";

const mocks = vi.hoisted(() => ({
  callPage: vi.fn(),
  mouseClick: vi.fn(async () => undefined),
  mouseMove: vi.fn(async () => undefined),
  insertText: vi.fn(async () => undefined),
  pressKey: vi.fn(async () => undefined),
  wheel: vi.fn(async () => undefined),
  tab: { id: 7, url: "https://x.com/" },
}));

vi.mock("../src/background/agent-tab", () => ({ getWorkableTab: async () => mocks.tab }));
vi.mock("../src/background/page-call", () => ({ callPage: mocks.callPage }));
vi.mock("../src/background/input", () => ({
  mouseClick: mocks.mouseClick, mouseMove: mocks.mouseMove, insertText: mocks.insertText, pressKey: mocks.pressKey, wheel: mocks.wheel,
  visualViewport: async () => ({ pageX: 0, pageY: 0, clientWidth: 1000, clientHeight: 800 }),
}));
vi.mock("../src/background/tab-load", () => ({ settle: async () => undefined }));
vi.mock("../src/background/commands/page-line", () => ({ pageLine: async () => 'Page is now "T" https://x.com/' }));

const { act, summarize, approvalRefusal } = await import("../src/background/commands/act");
const { resetApprovalsForTest, APPROVAL_TTL_MS } = await import("../src/background/approvals");

const facts = (over: Partial<ElementFacts>): ElementFacts => ({ tag: "button", role: "button", name: "Search", inForm: false, pageHost: "x.com", ...over });
const doc = { nonce: "n1", generation: 1, href: "https://x.com/" };
// `id` is the opaque element identity page.ts hands out: el1 is "the" element unless a test says another one.
const located = (f: ElementFacts, over: Record<string, unknown> = {}) => ({ found: true, x: 10, y: 20, facts: f, doc, id: "el1", ...(over.hit ? { hitId: "el2" } : {}), ...over });
const active = (f: ElementFacts, d = doc, id = "el1") => ({ facts: f, doc: d, id });
const focused = (f: ElementFacts, over: Record<string, unknown> = {}) => ({ found: true, onTarget: true, hadText: false, facts: f, doc, id: "el1", ...over });
const field = (over: Partial<ElementFacts> = {}) => facts({ tag: "input", type: "text", role: "textbox", name: "Guest", editable: true, ...over });
const save = () => facts({ type: "submit", name: "Save booking", inForm: true });
// What the page's `pick` op answers: the option a select would choose, in full.
const picked = (label: string, value = label, id = "o1") => ({ found: true, native: true, option: { id, label, value }, options: [label] });
const idOf = (text: string) => /approval_id: (ap_[a-z2-9]{12})\b/.exec(text)?.[1] ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.callPage.mockReset();
  mocks.tab = { id: 7, url: "https://x.com/" };
  const stored: Record<string, unknown> = {};
  (globalThis as { chrome?: unknown }).chrome = {
    tabs: { onCreated: { addListener: vi.fn(), removeListener: vi.fn() } },
    storage: { session: { get: async (k: string) => ({ [k]: stored[k] }), set: async (o: Record<string, unknown>) => void Object.assign(stored, o) } },
  };
  resetApprovalsForTest();
});

/** Runs `fn`, returns the approval records it left in chrome.storage.session under the shared key. */
async function storedApprovals(fn: () => Promise<void>): Promise<{ id: string; expiresAt: number; summary: string; pageUrl: string }[]> {
  await fn();
  const { APPROVALS_KEY } = await import("../src/shared/approvals-view");
  const got = await (globalThis as unknown as { chrome: { storage: { session: { get(k: string): Promise<Record<string, never>> } } } }).chrome.storage.session.get(APPROVALS_KEY);
  return got[APPROVALS_KEY] ?? [];
}

/** act on `f`, return the approval id it hands out. */
async function askFor(args: Parameters<typeof act>[0], f: ElementFacts, over: Record<string, unknown> = {}) {
  mocks.callPage.mockResolvedValueOnce(located(f, over));
  const out = await act(args, false);
  expect(out.status).toBe("needs_approval");
  return idOf(out.text);
}

describe("act", () => {
  it("clicks a safe element with a trusted mouse event and summarises", async () => {
    mocks.callPage.mockResolvedValueOnce(located(facts({})));
    const out = await act({ action: "click", ref: "e1" }, false);
    expect(mocks.mouseClick).toHaveBeenCalledWith({ id: 7, url: "https://x.com/" }, 10, 20);
    expect(out).toEqual({ status: "done", text: 'Clicked button "Search". Page is now "T" https://x.com/' });
  });

  it("refuses a submit button with needs_approval, an approval_id and no click", async () => {
    mocks.callPage.mockResolvedValueOnce(located(save()));
    const out = await act({ action: "click", ref: "e5" }, false);
    expect(out.status).toBe("needs_approval");
    expect(out.text).toContain("this click needs the owner's approval (submits a form: \"Save booking\")");
    expect(idOf(out.text)).toMatch(/^ap_[a-z2-9]{12}$/);
    expect(mocks.mouseClick).not.toHaveBeenCalled();
  });

  it("puts approval_id first, then how to call act_with_approval, so a cut-off text still has the id", async () => {
    mocks.callPage.mockResolvedValueOnce(located(save()));
    const { text } = await act({ action: "click", ref: "e5" }, false);
    const [first, second] = text.split("\n");
    expect(first).toMatch(/^approval_id: ap_[a-z2-9]{12}$/);
    expect(second).toContain("Call act_with_approval with approval_id first, then the same arguments, then a short reason (under 200 characters).");
    expect(text.indexOf("Not done:")).toBeGreaterThan(text.indexOf("act_with_approval"));
  });

  it("files a readable record in session storage for the side panel: summary and page url", async () => {
    const stored = await storedApprovals(async () => {
      await askFor({ action: "click", ref: "e5" }, save(), { doc: { ...doc, href: "https://x.com/cart#pay" } });
      mocks.callPage.mockResolvedValueOnce(active(field({ name: "Rate", inForm: true })));
      await act({ action: "press", key: "Enter" }, false);
      mocks.callPage.mockResolvedValueOnce(located(facts({ tag: "select", role: "combobox", name: "Guests", inForm: true })));
      mocks.callPage.mockResolvedValueOnce(picked("Two", "2"));
      await act({ action: "select", ref: "e2", text: "Two" }, false);
    });
    expect(stored.map((a) => [a.summary.split("\n")[0], a.pageUrl])).toEqual([
      ['Click button "Save booking"', "https://x.com/cart#pay"],
      ['Press Enter in textbox "Rate"', "https://x.com/"],
      ['Select the option "Two" (value "2") in combobox "Guests"', "https://x.com/"],
    ]);
    expect(stored[0]).toMatchObject({ id: expect.stringMatching(/^ap_/), expiresAt: expect.any(Number) });
  });

  describe("what the owner is shown", () => {
    const summaryOf = async (args: Parameters<typeof act>[0], f: ElementFacts, ...more: unknown[]) => {
      const all = await storedApprovals(async () => {
        mocks.callPage.mockResolvedValueOnce(located(f));
        for (const m of more) mocks.callPage.mockResolvedValueOnce(m);
        await act(args, false);
      });
      return all.at(-1)?.summary;
    };

    it("shows the real control: an aria-label cannot hide the visible text, and the reason and destination are given", async () => {
      const summary = await summaryOf({ action: "click", ref: "e1" }, facts({
        name: "Preview", ariaLabel: "Preview", text: "Delete account", type: "submit", inForm: true, formMethod: "post", activationUrl: "https://x.com/account/delete",
      }));
      expect(summary).toBe([
        'Click button "Preview" (visible text: "Delete account")',
        "Needs approval because: submits a form",
        "Destination: form POST to https://x.com/account/delete",
      ].join("\n"));
    });

    it("shows a link's destination, and a caption input's value", async () => {
      const link = await summaryOf({ action: "click", ref: "e1" }, facts({ tag: "a", role: "link", name: "Delete account", text: "Delete account", activationUrl: "https://evil.example/x" }));
      expect(link).toContain("Destination: opens https://evil.example/x");
      const input = await summaryOf({ action: "click", ref: "e1" }, facts({ tag: "input", type: "submit", name: "Go", ariaLabel: "Go", value: "Pay now", inForm: true }));
      expect(input).toContain('(visible text: "Pay now")');
    });

    it("shows the form's own page when it has no action", async () => {
      const summary = await summaryOf({ action: "click", ref: "e1" }, save());
      expect(summary).toContain("Destination: form GET to this same page");
    });

    it("shows the whole select option: a long value after a harmless start is not cut off", async () => {
      const value = `${"A".repeat(120)} then delete everything`;
      const summary = await summaryOf({ action: "select", ref: "e1", text: "Standard" }, facts({ tag: "select", role: "combobox", name: "Room", inForm: true }), picked("Standard", value));
      expect(summary).toContain(`value "${value}"`);
    });

    it("shows the label the option really has when the agent's words name something harmless", async () => {
      const summary = await summaryOf({ action: "select", ref: "e1", text: "ok" }, facts({ tag: "select", role: "combobox", name: "Next", inForm: true }), picked("Delete my account", "ok"));
      expect(summary).toContain('Select the option "Delete my account" (value "ok")');
    });

    it("files nothing for an option text over 500 characters, and says why", async () => {
      const long = "x".repeat(501);
      for (const option of [picked(long, "v"), picked("l", long)]) {
        const stored = await storedApprovals(async () => {
          mocks.callPage.mockResolvedValueOnce(located(facts({ tag: "select", role: "combobox", name: "Room", inForm: true })));
          mocks.callPage.mockResolvedValueOnce(option);
          const out = await act({ action: "select", ref: "e1", text: "l" }, false);
          expect(out.status).toBe("blocked");
          expect(out.text).toContain("option text too long to show the owner");
        });
        expect(stored).toEqual([]);
      }
    });

    it("shows exactly 500 characters in full", async () => {
      const exact = "y".repeat(500);
      const summary = await summaryOf({ action: "select", ref: "e1", text: "l" }, facts({ tag: "select", role: "combobox", name: "Room", inForm: true }), picked("l", exact));
      expect(summary).toContain(exact);
    });

    it("typed text is shown whole up to 500 characters; more is refused instead of clipped", () => {
      const aimed = { facts: field(), targets: [field()], ids: ["el1"] };
      expect(summarize({ action: "type", ref: "e1", text: "t".repeat(500) }, aimed, { reason: "r" })).toContain(`"${"t".repeat(500)}"`);
      expect(approvalRefusal({ action: "type", ref: "e1", text: "t".repeat(500) }, aimed)).toBeUndefined();
      expect(approvalRefusal({ action: "type", ref: "e1", text: "t".repeat(501) }, aimed)).toMatch(/text is too long to show the owner/);
    });
  });

  describe("a select is approved for the option it resolved to", () => {
    const room = () => facts({ tag: "select", role: "combobox", name: "Room", inForm: true });
    const args = { action: "select", ref: "e1", text: "Standard" } as const;
    const approve = async () => {
      mocks.callPage.mockResolvedValueOnce(located(room()));
      mocks.callPage.mockResolvedValueOnce(picked("Standard", "s", "o1"));
      return idOf((await act(args, false)).text);
    };
    const ops = () => mocks.callPage.mock.calls.map((c) => (c[1] as { op: string }).op);

    it("selects only that option, by identity, once approved", async () => {
      const id = await approve();
      mocks.callPage.mockReset();
      mocks.callPage.mockResolvedValueOnce(located(room()));
      mocks.callPage.mockResolvedValueOnce(picked("Standard", "s", "o1"));
      mocks.callPage.mockResolvedValueOnce({ ...picked("Standard", "s", "o1"), changed: true });
      const out = await act({ ...args, approval_id: id }, true);
      expect(out).toMatchObject({ status: "done" });
      expect(out.text).toContain('Selected "Standard" in combobox "Room"');
      expect(mocks.callPage).toHaveBeenLastCalledWith(expect.anything(), { op: "select", ref: "e1", text: "Standard", expect: "o1" });
    });

    it.each([
      ["another option under the same words", picked("Delete everything", "s", "o9")],
      ["the same option with a new label", picked("Delete everything", "s", "o1")],
      ["the same option with a new value", picked("Standard", "wipe", "o1")],
    ])("does not honour the approval when the words now resolve to %s", async (_n, now) => {
      const id = await approve();
      mocks.callPage.mockReset();
      mocks.callPage.mockResolvedValueOnce(located(room()));
      mocks.callPage.mockResolvedValueOnce(now);
      const out = await act({ ...args, approval_id: id }, true);
      expect(out.status).toBe("needs_approval");
      expect(out.text).toContain("changed since the owner was asked");
      expect(ops()).toEqual(["locate", "pick"]);  // select never ran
    });

    it("selects nothing when the option changes between the check and the select", async () => {
      const id = await approve();
      mocks.callPage.mockReset();
      mocks.callPage.mockResolvedValueOnce(located(room()));
      mocks.callPage.mockResolvedValueOnce(picked("Standard", "s", "o1"));
      mocks.callPage.mockResolvedValueOnce({ ...picked("Delete everything", "s", "o9"), changed: false });
      await expect(act({ ...args, approval_id: id }, true)).rejects.toThrow(/nothing was selected/);
    });

    it("says so when no option can be resolved, and files nothing", async () => {
      mocks.callPage.mockResolvedValueOnce(located(room()));
      mocks.callPage.mockResolvedValueOnce({ found: true, native: true, options: ["A", "B"] });
      await expect(act(args, false)).rejects.toThrow(/has no option "Standard". Options: A, B/);
    });
  });

  it("gives a different approval_id every time", async () => {
    const ids = new Set([await askFor({ action: "click", ref: "e5" }, save()), await askFor({ action: "click", ref: "e5" }, save())]);
    expect(ids.size).toBe(2);
  });

  it("clicks after approval, with the id the first call gave and the same arguments", async () => {
    const id = await askFor({ action: "click", ref: "e5" }, save());
    mocks.callPage.mockResolvedValueOnce(located(save()));
    const out = await act({ action: "click", ref: "e5", reason: "owner said so", approval_id: id }, true);
    expect(out.status).toBe("done");
    expect(mocks.mouseClick).toHaveBeenCalledOnce();
  });

  it("is single use: the same id does not click twice", async () => {
    const id = await askFor({ action: "click", ref: "e5" }, save());
    mocks.callPage.mockResolvedValue(located(save()));
    expect((await act({ action: "click", ref: "e5", approval_id: id }, true)).status).toBe("done");
    const again = await act({ action: "click", ref: "e5", approval_id: id }, true);
    expect(again.status).toBe("needs_approval");
    expect(again.text).toContain("unknown, expired or already used");
    expect(idOf(again.text)).not.toBe(id);
    expect(mocks.mouseClick).toHaveBeenCalledOnce();
  });

  it("does nothing without an approval_id or with an unknown one, and hands out a fresh id", async () => {
    mocks.callPage.mockResolvedValue(located(save()));
    for (const approval_id of [undefined, "ap_zzzzzzzzzzzz", ""]) {
      const out = await act({ action: "click", ref: "e5", approval_id }, true);
      expect(out.status).toBe("needs_approval");
      expect(idOf(out.text)).toMatch(/^ap_/);
    }
    expect(mocks.mouseClick).not.toHaveBeenCalled();
  });

  it("does not accept an id after 10 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const id = await askFor({ action: "click", ref: "e5" }, save());
      vi.setSystemTime(Date.now() + APPROVAL_TTL_MS + 1);
      mocks.callPage.mockResolvedValue(located(save()));
      const out = await act({ action: "click", ref: "e5", approval_id: id }, true);
      expect(out.status).toBe("needs_approval");
      expect(mocks.mouseClick).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts an id just before it expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const id = await askFor({ action: "click", ref: "e5" }, save());
      vi.setSystemTime(Date.now() + APPROVAL_TTL_MS - 1000);
      mocks.callPage.mockResolvedValue(located(save()));
      expect((await act({ action: "click", ref: "e5", approval_id: id }, true)).status).toBe("done");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps approvals across a service worker restart (session storage)", async () => {
    const id = await askFor({ action: "click", ref: "e5" }, save());
    resetApprovalsForTest();
    mocks.callPage.mockResolvedValue(located(save()));
    expect((await act({ action: "click", ref: "e5", approval_id: id }, true)).status).toBe("done");
  });

  describe("when what was approved no longer matches", () => {
    const mismatches: [string, Parameters<typeof act>[0], () => void, ElementFacts, Record<string, unknown>][] = [
      ["other arguments (another ref)", { action: "click", ref: "e6" }, () => undefined, save(), {}],
      ["another tab", { action: "click", ref: "e5" }, () => { mocks.tab = { id: 8, url: "https://x.com/" }; }, save(), {}],
      ["another document", { action: "click", ref: "e5" }, () => undefined, save(), { doc: { ...doc, nonce: "n2" } }],
      ["a newer snapshot", { action: "click", ref: "e5" }, () => undefined, save(), { doc: { ...doc, generation: 2 } }],
      ["a same-document route change (same document, new location.href)", { action: "click", ref: "e5" }, () => undefined, save(), { doc: { ...doc, href: "https://x.com/#/other" } }],
      ["another element that looks exactly the same (identity, not description)", { action: "click", ref: "e5" }, () => undefined, save(), { id: "el9" }],
      ["another element under the pointer that looks the same", { action: "click", ref: "e5" }, () => undefined, save(), { hit: save(), hitId: "el9" }],
      ["another element", { action: "click", ref: "e5" }, () => undefined, { ...save(), name: "Delete booking" }, {}],
      ["another form action", { action: "click", ref: "e5" }, () => undefined, { ...save(), formAction: "/steal" }, {}],
      ["another link target", { action: "click", ref: "e5" }, () => undefined, { ...save(), activationUrl: "https://evil.test/" }, {}],
      ["another element under the pointer", { action: "click", ref: "e5" }, () => undefined, save(), { hit: facts({ type: "submit", name: "Wire money", inForm: true }) }],
    ];
    it.each(mismatches)("%s: nothing is done, the old id is spent, a new id is issued", async (_n, args, change, f, over) => {
      const id = await askFor({ action: "click", ref: "e5" }, save());
      change();
      mocks.callPage.mockResolvedValue(located(f, over));
      const out = await act({ ...args, approval_id: id }, true);
      expect(out.status).toBe("needs_approval");
      expect(out.text).toContain("changed since the owner was asked");
      const fresh = idOf(out.text);
      expect(fresh).toMatch(/^ap_/);
      expect(fresh).not.toBe(id);
      expect(mocks.mouseClick).not.toHaveBeenCalled();
      expect(mocks.mouseMove).not.toHaveBeenCalled();
      // the old id is spent even though it was refused
      mocks.tab = { id: 7, url: "https://x.com/" };
      mocks.callPage.mockResolvedValue(located(save()));
      const retry = await act({ action: "click", ref: "e5", approval_id: id }, true);
      expect(retry.text).toContain("unknown, expired or already used");
      expect(mocks.mouseClick).not.toHaveBeenCalled();
    });

    it("the key is part of the approval: Enter approved does not cover Shift+Enter", async () => {
      mocks.callPage.mockResolvedValueOnce(active(field({ inForm: true })));
      const id = idOf((await act({ action: "press", key: "Enter" }, false)).text);
      mocks.callPage.mockResolvedValueOnce(active(field({ inForm: true })));
      const out = await act({ action: "press", key: "Shift+Enter", approval_id: id }, true);
      expect(out.status).toBe("needs_approval");
      expect(mocks.pressKey).not.toHaveBeenCalled();
    });
  });

  it("never lets an approval bypass blocked, even with a valid id", async () => {
    mocks.callPage.mockResolvedValue(located(facts({ tag: "a", role: "link", name: "Home", activationUrl: "javascript:steal()" })));
    const out = await act({ action: "click", ref: "e1", approval_id: "ap_aaaaaaaaaaaa" }, true);
    expect(out.status).toBe("blocked");
    expect(mocks.mouseClick).not.toHaveBeenCalled();
  });

  it("blocks a click on a javascript: link, form action or formaction (not only navigate)", async () => {
    mocks.callPage.mockResolvedValue(located(facts({ tag: "button", type: "submit", name: "Go", inForm: true, activationUrl: "javascript:x()" })));
    expect((await act({ action: "click", ref: "e1" }, false)).status).toBe("blocked");
    expect(mocks.mouseClick).not.toHaveBeenCalled();
  });

  it("tells the agent to use act when act_with_approval arrives for something that is no longer risky", async () => {
    const id = await askFor({ action: "click", ref: "e5" }, save());
    mocks.callPage.mockResolvedValue(located(facts({ name: "Details", tag: "div", role: "button" })));
    await expect(act({ action: "click", ref: "e5", approval_id: id }, true)).rejects.toThrow(/Call act instead/);
    expect(mocks.mouseClick).not.toHaveBeenCalled();
  });

  it("judges the element that really receives the click, not only the one aimed at", async () => {
    mocks.callPage.mockResolvedValueOnce(located(facts({ tag: "div", name: "Open" }), { hit: facts({ type: "submit", name: "Open", inForm: true }) }));
    const out = await act({ action: "click", x: 10, y: 20 }, false);
    expect(out.status).toBe("needs_approval");
    expect(mocks.mouseClick).not.toHaveBeenCalled();
  });

  describe("approval is bound to the element itself", () => {
    // Every row has the same Delete button: nothing in the facts tells them apart, only the element id does.
    const deleteIn = (_row: string) => facts({ name: "Delete", tag: "button", type: "button", text: "Delete" });

    it("a coordinate click approved on one Delete button does not cover an identical Delete that scrolled under the same point", async () => {
      mocks.callPage.mockResolvedValueOnce(located(deleteIn("row 1"), { id: "el10" }));
      const asked = await act({ action: "click", x: 10, y: 20 }, false);
      expect(asked.status).toBe("needs_approval");
      mocks.callPage.mockResolvedValueOnce(located(deleteIn("row 7"), { id: "el77" }));
      const out = await act({ action: "click", x: 10, y: 20, approval_id: idOf(asked.text) }, true);
      expect(out.status).toBe("needs_approval");
      expect(out.text).toContain("changed since the owner was asked");
      expect(mocks.mouseClick).not.toHaveBeenCalled();
    });

    it("the same coordinate click still runs when the same element is under the point", async () => {
      mocks.callPage.mockResolvedValue(located(deleteIn("row 1"), { id: "el10" }));
      const asked = await act({ action: "click", x: 10, y: 20 }, false);
      const out = await act({ action: "click", x: 10, y: 20, approval_id: idOf(asked.text) }, true);
      expect(out.status).toBe("done");
      expect(mocks.mouseClick).toHaveBeenCalledOnce();
    });

    it("a ref approved for one Delete does not cover another Delete that took over the ref", async () => {
      mocks.callPage.mockResolvedValueOnce(located(deleteIn("a"), { id: "el1" }));
      const asked = await act({ action: "click", ref: "e3" }, false);
      mocks.callPage.mockResolvedValueOnce(located(deleteIn("b"), { id: "el2" }));
      const out = await act({ action: "click", ref: "e3", approval_id: idOf(asked.text) }, true);
      expect(out.status).toBe("needs_approval");
      expect(mocks.mouseClick).not.toHaveBeenCalled();
    });

    it("Enter approved in one field does not cover an identical field that has focus now", async () => {
      mocks.callPage.mockResolvedValueOnce(active(field({ inForm: true }), doc, "el4"));
      const asked = await act({ action: "press", key: "Enter" }, false);
      mocks.callPage.mockResolvedValueOnce(active(field({ inForm: true }), doc, "el5"));
      const out = await act({ action: "press", key: "Enter", approval_id: idOf(asked.text) }, true);
      expect(out.status).toBe("needs_approval");
      expect(mocks.pressKey).not.toHaveBeenCalled();
    });

    it("a key pressed on a ref is bound to the element that took focus", async () => {
      mocks.callPage.mockResolvedValueOnce(focused(field({ inForm: true }), { id: "el4" }));
      const asked = await act({ action: "press", key: "Enter", ref: "e2" }, false);
      mocks.callPage.mockResolvedValueOnce(focused(field({ inForm: true }), { id: "el5" }));
      const out = await act({ action: "press", key: "Enter", ref: "e2", approval_id: idOf(asked.text) }, true);
      expect(out.status).toBe("needs_approval");
      expect(mocks.pressKey).not.toHaveBeenCalled();
    });
  });

  describe("frames and focus that cannot be inspected", () => {
    const frame = () => facts({ tag: "iframe", role: "clickable", name: "Pay" });

    it.each([
      ["type", { action: "type", ref: "e1", text: "4242" }],
      ["select", { action: "select", ref: "e1", text: "x" }],
    ] as const)("blocks %s on a frame, even with an approval id", async (_n, args) => {
      mocks.callPage.mockResolvedValue(located(frame()));
      for (const approved of [false, true]) expect((await act({ ...args, approval_id: "ap_aaaaaaaaaaaa" }, approved)).status).toBe("blocked");
      expect(mocks.insertText).not.toHaveBeenCalled();
    });

    it("blocks a key when focus is inside an iframe (the iframe is reported as the focused element)", async () => {
      mocks.callPage.mockResolvedValue(active(frame()));
      for (const key of ["a", "Enter", "ArrowDown"]) {
        expect((await act({ action: "press", key }, false)).status).toBe("blocked");
        expect((await act({ action: "press", key, approval_id: "ap_aaaaaaaaaaaa" }, true)).status).toBe("blocked");
      }
      expect(mocks.pressKey).not.toHaveBeenCalled();
    });

    it("blocks a key when the focused element cannot be resolved", async () => {
      mocks.callPage.mockResolvedValueOnce(undefined);
      expect((await act({ action: "press", key: "x" }, false)).status).toBe("blocked");
      expect(mocks.pressKey).not.toHaveBeenCalled();
    });

    it("blocks typing at x,y when the click moved focus into a frame", async () => {
      mocks.callPage.mockResolvedValueOnce(located(field())).mockResolvedValueOnce(active(frame()));
      expect((await act({ action: "type", x: 10, y: 20, text: "x" }, false)).status).toBe("blocked");
      expect(mocks.insertText).not.toHaveBeenCalled();
    });
  });

  describe("one value-change policy", () => {
    const select = (over: Partial<ElementFacts> = {}) => facts({ tag: "select", role: "combobox", name: "Bed type", inForm: true, ...over });

    it.each(["ArrowDown", "ArrowUp", "Home", "End", "PageUp", "PageDown", "Space", "k"])("press %s on a form select needs approval, like the select action", async (key) => {
      mocks.callPage.mockResolvedValueOnce(active(select()));
      expect((await act({ action: "press", key }, false)).status).toBe("needs_approval");
      expect(mocks.pressKey).not.toHaveBeenCalled();
    });

    it("blocks the same keys on a card expiry select, the select action and an option click", async () => {
      const month = select({ name: "Month", autocomplete: "cc-exp-month" });
      mocks.callPage.mockResolvedValue(active(month));
      expect((await act({ action: "press", key: "ArrowDown" }, false)).status).toBe("blocked");
      mocks.callPage.mockResolvedValue(located(month));
      expect((await act({ action: "select", ref: "e1", text: "12" }, false)).status).toBe("blocked");
      mocks.callPage.mockResolvedValue(located(facts({ tag: "option", role: "option", name: "12", autocomplete: "cc-exp-month" })));
      expect((await act({ action: "click", ref: "e1" }, false)).status).toBe("blocked");
      expect(mocks.pressKey).not.toHaveBeenCalled();
      expect(mocks.mouseClick).not.toHaveBeenCalled();
    });

    it("an option click in a form needs approval like select; Tab on the select does not", async () => {
      mocks.callPage.mockResolvedValueOnce(located(facts({ tag: "option", role: "option", name: "Twin", inForm: true })));
      expect((await act({ action: "click", ref: "e1" }, false)).status).toBe("needs_approval");
      mocks.callPage.mockResolvedValueOnce(active(select()));
      expect((await act({ action: "press", key: "Tab" }, false)).status).toBe("done");
    });
  });

  it("asks before a click at x,y that lands on a frame", async () => {
    mocks.callPage.mockResolvedValueOnce(located(facts({ tag: "iframe", role: "clickable", name: "" })));
    expect((await act({ action: "click", x: 10, y: 20 }, false)).status).toBe("needs_approval");
    expect(mocks.mouseClick).not.toHaveBeenCalled();
  });

  it("blocks typing into a password field even when approved", async () => {
    mocks.callPage.mockResolvedValueOnce(located(field({ type: "password", name: "Password" })));
    const out = await act({ action: "type", ref: "e3", text: "hunter2" }, true);
    expect(out.status).toBe("blocked");
    expect(mocks.insertText).not.toHaveBeenCalled();
  });

  it("types after focusing and clearing the field", async () => {
    mocks.callPage
      .mockResolvedValueOnce(located(field()))
      .mockResolvedValueOnce(focused(field(), { hadText: true }));
    const out = await act({ action: "type", ref: "e2", text: "Ada" }, false);
    expect(mocks.callPage).toHaveBeenLastCalledWith(expect.anything(), { op: "focus", ref: "e2", clear: true });
    expect(mocks.pressKey).toHaveBeenCalledWith(expect.anything(), "Backspace");
    expect(mocks.insertText).toHaveBeenCalledWith(expect.anything(), "Ada");
    expect(out.text).toContain('Typed 3 characters into textbox "Guest".');
  });

  it("does not type when focus did not land on the target ref", async () => {
    mocks.callPage
      .mockResolvedValueOnce(located(field()))
      .mockResolvedValueOnce(focused(field({ type: "password", name: "Password" }), { onTarget: false }));
    await expect(act({ action: "type", ref: "e2", text: "x" }, false)).rejects.toThrow(/did not take keyboard focus/);
    expect(mocks.insertText).not.toHaveBeenCalled();
  });

  it("types at x,y only after checking what took focus: a sensitive field is blocked before any text", async () => {
    mocks.callPage
      .mockResolvedValueOnce(located(field()))
      .mockResolvedValueOnce(active(field({ autocomplete: "one-time-code" })));
    const out = await act({ action: "type", x: 10, y: 20, text: "123456" }, false);
    expect(out.status).toBe("blocked");
    expect(mocks.insertText).not.toHaveBeenCalled();
    expect(mocks.pressKey).not.toHaveBeenCalled();
  });

  it("types at x,y into the field that took focus", async () => {
    mocks.callPage.mockResolvedValueOnce(located(field())).mockResolvedValueOnce(active(field()));
    const out = await act({ action: "type", x: 10, y: 20, text: "Ada" }, false);
    expect(out.status).toBe("done");
    expect(mocks.pressKey).toHaveBeenNthCalledWith(1, expect.anything(), "Control+A");
    expect(mocks.insertText).toHaveBeenCalledWith(expect.anything(), "Ada");
  });

  it("explains a stale ref and a text-less target", async () => {
    mocks.callPage.mockResolvedValueOnce({ found: false, reason: "gone" });
    await expect(act({ action: "click", ref: "e12" }, false)).rejects.toThrow("Element e12 is gone. Take a new snapshot.");
    mocks.callPage.mockResolvedValueOnce(located(facts({ name: "Search" })));
    await expect(act({ action: "type", ref: "e1", text: "x" }, false)).rejects.toThrow(/not a text field/);
  });

  it("rejects missing arguments with a sentence", async () => {
    await expect(act({ action: "click" }, false)).rejects.toThrow("'click' needs a ref from the last snapshot, or x and y.");
    await expect(act({ action: "press" }, false)).rejects.toThrow(/'press' needs key/);
  });

  describe("press", () => {
    it("is refused when it carries x or y, before anything is read or sent", async () => {
      await expect(act({ action: "press", key: "Enter", x: 5, y: 5 }, false)).rejects.toThrow(/'press' needs no x and y/);
      await expect(act({ action: "press", key: "Enter", x: 5 }, true)).rejects.toThrow(/'press' needs no x and y/);
      expect(mocks.callPage).not.toHaveBeenCalled();
      expect(mocks.pressKey).not.toHaveBeenCalled();
    });

    it("asks before Enter in a text field and presses after approval", async () => {
      mocks.callPage.mockResolvedValueOnce(active(field({ inForm: true })));
      const out = await act({ action: "press", key: "Enter" }, false);
      expect(out.status).toBe("needs_approval");
      expect(mocks.pressKey).not.toHaveBeenCalled();
      mocks.callPage.mockResolvedValueOnce(active(field({ inForm: true })));
      const done = await act({ action: "press", key: "Enter", approval_id: idOf(out.text) }, true);
      expect(done.status).toBe("done");
      expect(mocks.pressKey).toHaveBeenCalledWith(expect.anything(), "Enter");
    });

    it("with a ref, focuses it and judges the element that really has focus", async () => {
      // the ref is a harmless div, but it cannot take focus: the Pay button keeps it, and Enter would click that
      mocks.callPage.mockResolvedValueOnce(focused(facts({ name: "Pay now" }), { onTarget: false }));
      const out = await act({ action: "press", key: "Enter", ref: "e2" }, false);
      expect(mocks.callPage).toHaveBeenCalledWith(expect.anything(), { op: "focus", ref: "e2", clear: false });
      expect(out.status).toBe("needs_approval");
      expect(out.text).toContain("Pay now");
      expect(mocks.pressKey).not.toHaveBeenCalled();
    });

    it("with a ref whose focus lands on a blocked field, blocks", async () => {
      mocks.callPage.mockResolvedValueOnce(focused(field({ autocomplete: "cc-number" }), { onTarget: false }));
      expect((await act({ action: "press", key: "5", ref: "e2" }, true)).status).toBe("blocked");
      expect(mocks.pressKey).not.toHaveBeenCalled();
    });

    it("with a ref that cannot take focus and a harmless holder, says so instead of pressing", async () => {
      mocks.callPage.mockResolvedValueOnce(focused(facts({ tag: "body", role: "clickable", name: "" }), { onTarget: false }));
      await expect(act({ action: "press", key: "ArrowDown", ref: "e2" }, false)).rejects.toThrow(/cannot take keyboard focus/);
      expect(mocks.pressKey).not.toHaveBeenCalled();
    });

    it("with a ref that has focus, presses a harmless key", async () => {
      mocks.callPage.mockResolvedValueOnce(focused(field()));
      const out = await act({ action: "press", key: "Tab", ref: "e2" }, false);
      expect(out.status).toBe("done");
      expect(mocks.pressKey).toHaveBeenCalledWith(expect.anything(), "Tab");
    });

    it("fails closed when the focused element cannot be resolved", async () => {
      mocks.callPage.mockResolvedValueOnce(undefined);
      const out = await act({ action: "press", key: "Tab" }, false);
      expect(out.status).toBe("blocked");
      expect(mocks.pressKey).not.toHaveBeenCalled();
    });

    it("asks for Control+Enter anywhere", async () => {
      mocks.callPage.mockResolvedValueOnce(active(facts({ tag: "body", role: "clickable", name: "" })));
      expect((await act({ action: "press", key: "ctrl+enter" }, false)).status).toBe("needs_approval");
      expect(mocks.pressKey).not.toHaveBeenCalled();
    });
  });

  it("scrolls the page centre by one screen by default, without reading the page", async () => {
    await act({ action: "scroll", direction: "down" }, false);
    expect(mocks.callPage).not.toHaveBeenCalled();
    expect(mocks.wheel).toHaveBeenCalledWith(expect.anything(), 500, 400, 0, 800);
  });

  describe("when the bridge connection is replaced while the command runs", () => {
    /** A liveness flag the test turns off, as a reconnect does. */
    const alive = () => {
      const state = { current: true };
      return { state, isCurrent: () => state.current };
    };

    it("does not click if the connection went away while the page was being read", async () => {
      const { state, isCurrent } = alive();
      mocks.callPage.mockImplementationOnce(async () => {
        state.current = false;
        return located(facts({}));
      });
      await expect(act({ action: "click", ref: "e1" }, false, isCurrent)).rejects.toThrow(/bridge connection changed/);
      expect(mocks.mouseClick).not.toHaveBeenCalled();
    });

    it("does not focus or scroll for a command that is already stale", async () => {
      const { state, isCurrent } = alive();
      state.current = false;
      await expect(act({ action: "click", ref: "e1" }, false, isCurrent)).rejects.toThrow(/bridge connection changed/);
      await expect(act({ action: "press", key: "Tab", ref: "e1" }, false, isCurrent)).rejects.toThrow(/bridge connection changed/);
      expect(mocks.callPage).not.toHaveBeenCalled();
    });

    it("stops a typing command between its steps: no Backspace, no text", async () => {
      const { state, isCurrent } = alive();
      mocks.callPage.mockResolvedValueOnce(located(field())).mockImplementationOnce(async () => {
        state.current = false;
        return focused(field(), { hadText: true });
      });
      await expect(act({ action: "type", ref: "e2", text: "Ada" }, false, isCurrent)).rejects.toThrow(/bridge connection changed/);
      expect(mocks.pressKey).not.toHaveBeenCalled();
      expect(mocks.insertText).not.toHaveBeenCalled();
    });

    it.each([
      ["press", { action: "press", key: "Tab" } as const, () => active(field())],
      ["hover", { action: "hover", ref: "e1" } as const, () => located(facts({}))],
      ["select", { action: "select", ref: "e1", text: "x" } as const, () => located(facts({ tag: "select", role: "combobox", name: "Bed" }))],
    ])("does not %s once the connection is gone", async (_n, args, read) => {
      const { state, isCurrent } = alive();
      mocks.callPage.mockImplementationOnce(async () => {
        state.current = false;
        return read();
      });
      await expect(act(args, false, isCurrent)).rejects.toThrow(/bridge connection changed/);
      expect(mocks.callPage).toHaveBeenCalledOnce();  // the select op itself never ran
      expect(mocks.pressKey).not.toHaveBeenCalled();
      expect(mocks.mouseMove).not.toHaveBeenCalled();
    });

    it("does not scroll once the connection is gone", async () => {
      await expect(act({ action: "scroll", direction: "down" }, false, () => false)).rejects.toThrow(/bridge connection changed/);
      expect(mocks.wheel).not.toHaveBeenCalled();
    });
  });
});
