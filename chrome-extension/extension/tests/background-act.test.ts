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

const { act } = await import("../src/background/commands/act");
const { resetApprovalsForTest, APPROVAL_TTL_MS } = await import("../src/background/approvals");

const facts = (over: Partial<ElementFacts>): ElementFacts => ({ tag: "button", role: "button", name: "Search", inForm: false, pageHost: "x.com", ...over });
const doc = { nonce: "n1", generation: 1 };
const located = (f: ElementFacts, over: Record<string, unknown> = {}) => ({ found: true, x: 10, y: 20, facts: f, doc, ...over });
const active = (f: ElementFacts, d = doc) => ({ facts: f, doc: d });
const focused = (f: ElementFacts, over: Record<string, unknown> = {}) => ({ found: true, onTarget: true, hadText: false, facts: f, doc, ...over });
const field = (over: Partial<ElementFacts> = {}) => facts({ tag: "input", type: "text", role: "textbox", name: "Guest", editable: true, ...over });
const save = () => facts({ type: "submit", name: "Save booking", inForm: true });
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
    expect(out.text).toContain("Call act_with_approval with that approval_id, the same arguments and a short reason");
    expect(mocks.mouseClick).not.toHaveBeenCalled();
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
      ["another document", { action: "click", ref: "e5" }, () => undefined, save(), { doc: { nonce: "n2", generation: 1 } }],
      ["a newer snapshot", { action: "click", ref: "e5" }, () => undefined, save(), { doc: { nonce: "n1", generation: 2 } }],
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
      expect(out.status).toBe("needs_approval");
      expect(idOf(out.text)).toMatch(/^ap_/);
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
});
