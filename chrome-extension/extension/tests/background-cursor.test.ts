import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElementFacts } from "../src/background/risk";

const mocks = vi.hoisted(() => ({
  log: [] as string[],
  callPage: vi.fn(),
  executeScript: vi.fn(),
  tab: { id: 7, url: "https://x.com/" },
}));

vi.mock("../src/background/agent-tab", () => ({ getWorkableTab: async () => mocks.tab }));
vi.mock("../src/background/page-call", () => ({ callPage: mocks.callPage }));
vi.mock("../src/background/input", () => ({
  mouseClick: async () => void mocks.log.push("mouseClick"),
  mouseMove: async () => void mocks.log.push("mouseMove"),
  insertText: async () => void mocks.log.push("insertText"),
  pressKey: async () => void mocks.log.push("pressKey"),
  wheel: async () => void mocks.log.push("wheel"),
  visualViewport: async () => ({ pageX: 0, pageY: 0, clientWidth: 1000, clientHeight: 800 }),
}));
vi.mock("../src/background/tab-load", () => ({ settle: async () => undefined }));
vi.mock("../src/background/commands/page-line", () => ({ pageLine: async () => "Page." }));

const { act } = await import("../src/background/commands/act");
const { cursor, glideMs, hermesCursor, CURSOR_STYLE, resetCursorForTest } = await import("../src/background/cursor");
const { resetApprovalsForTest } = await import("../src/background/approvals");

const facts = (over: Partial<ElementFacts> = {}): ElementFacts => ({ tag: "button", role: "button", name: "Search", inForm: false, pageHost: "x.com", ...over });
const doc = { nonce: "n1", generation: 1, href: "https://x.com/" };
const located = (f: ElementFacts) => ({ found: true, x: 120, y: 340, facts: f, doc, id: "el1" });
const focused = (f: ElementFacts) => ({ found: true, onTarget: true, hadText: false, facts: f, doc, id: "el1" });
const field = () => facts({ tag: "input", type: "text", role: "textbox", name: "Guest", editable: true });
type Sent = { op: string; text?: string | null; x?: number; y?: number; pulse?: boolean };
const sent = () => mocks.executeScript.mock.calls.map((c) => c[0].args[0] as Sent);

/** The cursor runs a script in the tab; here it records itself in the same log as the real input, and a move takes a moment. */
function recordCursor(): void {
  mocks.executeScript.mockImplementation(async ({ args }: { args: [Sent] }) => {
    const [req] = args;
    mocks.log.push(`cursor:${req.op}${req.op === "move" ? ":start" : req.text ? `:${req.text}` : ""}`);
    if (req.op === "move") {
      await new Promise((r) => setTimeout(r, 5));
      mocks.log.push("cursor:move:end");
    }
    return [{ result: undefined }];
  });
}

beforeEach(() => {
  mocks.log.length = 0;
  mocks.callPage.mockReset();
  mocks.executeScript.mockReset();
  recordCursor();
  const stored: Record<string, unknown> = {};
  (globalThis as { chrome?: unknown }).chrome = {
    scripting: { executeScript: mocks.executeScript },
    tabs: { onCreated: { addListener: vi.fn(), removeListener: vi.fn() } },
    storage: { session: { get: async (k: string) => ({ [k]: stored[k] }), set: async (o: Record<string, unknown>) => void Object.assign(stored, o) } },
  };
  resetApprovalsForTest();
  resetCursorForTest();
});

describe("glideMs", () => {
  it("takes 180 ms for a hop and at most 600 ms for any distance, growing with distance", () => {
    expect(glideMs(0)).toBe(180);
    expect(glideMs(10)).toBeGreaterThanOrEqual(180);
    expect(glideMs(100)).toBeLessThan(glideMs(500));
    expect(glideMs(500)).toBeLessThan(glideMs(1000));
    expect(glideMs(1100)).toBe(600);
    expect(glideMs(100000)).toBe(600);
  });

  it("uses a middle value for the first appearance and for a distance it cannot trust", () => {
    for (const d of [undefined, NaN, Infinity]) {
      expect(glideMs(d)).toBeGreaterThanOrEqual(180);
      expect(glideMs(d)).toBeLessThanOrEqual(600);
    }
  });
});

describe("act: the cursor arrives before the real input", () => {
  it.each([
    ["click", { action: "click", ref: "e1" } as const, () => located(facts()), "mouseClick"],
    ["hover", { action: "hover", ref: "e1" } as const, () => located(facts()), "mouseMove"],
    ["scroll at an element", { action: "scroll", ref: "e1", direction: "down" } as const, () => located(facts()), "wheel"],
  ])("%s: the move has finished before the input is sent", async (_n, args, read, input) => {
    mocks.callPage.mockResolvedValueOnce(read());
    expect((await act(args, false)).status).toBe("done");
    const at = mocks.log.indexOf(input);
    expect(mocks.log.indexOf("cursor:move:end")).toBeGreaterThan(-1);
    expect(mocks.log.indexOf("cursor:move:end")).toBeLessThan(at);
  });

  it("click: moves to the same point the real click uses, with the pulse", async () => {
    mocks.callPage.mockResolvedValueOnce(located(facts()));
    await act({ action: "click", ref: "e1" }, false);
    expect(sent().find((r) => r.op === "move")).toMatchObject({ x: 120, y: 340, pulse: true });
    expect(mocks.log.filter((l) => l === "mouseMove")).toEqual([]);  // no extra mouse events of the cursor's own
  });

  it("hover moves without a pulse", async () => {
    mocks.callPage.mockResolvedValueOnce(located(facts()));
    await act({ action: "hover", ref: "e1" }, false);
    expect(sent().find((r) => r.op === "move")).toMatchObject({ pulse: false });
  });

  it("type at a coordinate: arrives, then clicks, with Typing... in the pill while the text goes in", async () => {
    mocks.callPage
      .mockResolvedValueOnce(located(field()))      // aim
      .mockResolvedValueOnce({ found: true, facts: field(), doc, id: "el1" });  // active, after the click
    expect((await act({ action: "type", x: 120, y: 340, text: "hello", clear: false }, false)).status).toBe("done");
    expect(mocks.log.filter((l) => /^(cursor:move|mouseClick|cursor:say|insertText)/.test(l))).toEqual([
      "cursor:move:start", "cursor:move:end", "mouseClick", "cursor:say:Typing...", "insertText", "cursor:say",
    ]);
    expect(sent().find((r) => r.op === "move")?.pulse).toBe(true);
  });

  it("press shows the key in the pill before it is sent", async () => {
    mocks.callPage.mockResolvedValueOnce({ facts: field(), doc, id: "el1" });
    await act({ action: "press", key: "Tab" }, false);
    expect(mocks.log.filter((l) => /^(cursor:say|pressKey)/.test(l))).toEqual(["cursor:say:Tab", "pressKey"]);
  });

  it("select moves to the dropdown first", async () => {
    const select = facts({ tag: "select", role: "combobox", name: "Room" });
    mocks.callPage
      .mockResolvedValueOnce(located(select))
      .mockResolvedValueOnce({ found: true, native: true, option: { id: "o1", label: "Deluxe", value: "d" }, options: ["Deluxe"] })
      .mockResolvedValueOnce({ found: true, native: true, changed: true, option: { id: "o1", label: "Deluxe", value: "d" }, options: [] });
    expect((await act({ action: "select", ref: "e1", text: "Deluxe" }, false)).status).toBe("done");
    expect(mocks.log.indexOf("cursor:move:end")).toBeGreaterThan(-1);
  });

  it("needs_approval: no click, no pulse, the pill says Waiting for approval", async () => {
    mocks.callPage.mockResolvedValueOnce(located(facts({ type: "submit", name: "Save booking", inForm: true })));
    const out = await act({ action: "click", ref: "e1" }, false);
    expect(out.status).toBe("needs_approval");
    expect(mocks.log).not.toContain("mouseClick");
    expect(sent().some((r) => r.op === "move" && r.pulse)).toBe(false);
    expect(sent().at(-1)).toMatchObject({ op: "say", text: "Waiting for approval" });
  });

  it("the cursor is not drawn for a blocked action", async () => {
    mocks.callPage.mockResolvedValueOnce(located(facts({ tag: "iframe", role: "clickable", name: "Pay" })));
    expect((await act({ action: "type", ref: "e1", text: "4242" }, false)).status).toBe("blocked");
    expect(sent().some((r) => r.op === "say" && r.text === "Waiting for approval")).toBe(false);
    expect(mocks.log).not.toContain("insertText");
  });
});

describe("a cursor failure never fails a command", () => {
  const click = async () => {
    mocks.callPage.mockResolvedValueOnce(located(facts()));
    return act({ action: "click", ref: "e1" }, false);
  };

  it("when the script is rejected (no access to the page, tab closed)", async () => {
    mocks.executeScript.mockRejectedValue(new Error("Cannot access contents of the page"));
    expect(await click()).toMatchObject({ status: "done" });
    expect(mocks.log).toContain("mouseClick");
  });

  it("when chrome.scripting throws at once, or does not exist", async () => {
    mocks.executeScript.mockImplementation(() => { throw new Error("boom"); });
    expect((await click()).status).toBe("done");
    (globalThis as unknown as { chrome: { scripting?: unknown } }).chrome.scripting = undefined;
    expect((await click()).status).toBe("done");
  });

  describe("when the page never answers", () => {
    beforeEach(() => void vi.useFakeTimers());
    afterEach(() => void vi.useRealTimers());

    it("gives up waiting, and the click still goes in", async () => {
      mocks.executeScript.mockImplementation(() => new Promise(() => undefined));
      mocks.callPage.mockResolvedValueOnce(located(facts()));
      const done = act({ action: "click", ref: "e1" }, false);
      await vi.advanceTimersByTimeAsync(5000);
      expect((await done).status).toBe("done");
      expect(mocks.log).toContain("mouseClick");
    });

    it("an overlay call that fails after it lost the race is not an unhandled rejection", async () => {
      let fail!: (e: Error) => void;
      mocks.executeScript.mockImplementation(() => new Promise((_r, rej) => (fail = rej)));
      const call = cursor.busy({ id: 7 });
      await vi.advanceTimersByTimeAsync(1500);
      await call;
      fail(new Error("late"));
      await vi.advanceTimersByTimeAsync(10);
    });
  });
});

describe("cursor.moveTo", () => {
  it("remembers the last point per tab: the second glide starts there and is timed by the distance", async () => {
    await cursor.moveTo({ id: 7 }, 100, 100);
    await cursor.moveTo({ id: 7 }, 700, 100, { pulse: true });
    await cursor.moveTo({ id: 8 }, 5, 5);
    const moves = sent();
    expect(moves[0]).toMatchObject({ from: undefined, ms: glideMs(undefined) });
    expect(moves[1]).toMatchObject({ from: { x: 100, y: 100 }, ms: 420, pulse: true });
    expect(moves[2]).toMatchObject({ from: undefined });
  });
});

describe("the overlay in the page", () => {
  const run = (req: Parameters<typeof hermesCursor>[0]) => hermesCursor(req, CURSOR_STYLE);
  const host = () => document.documentElement.querySelector("hermes-agent-cursor") as HTMLElement | null;
  const reducedMotion = (on: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("reduce") }));

  beforeEach(() => {
    document.body.innerHTML = `<button id="b">Real button</button>`;
    host()?.remove();
    delete (globalThis as { __hermesCursor?: unknown }).__hermesCursor;
    reducedMotion(true);
  });
  afterEach(() => void vi.unstubAllGlobals());

  it("lives on documentElement outside body, behind a closed shadow root, so the snapshot and innerText never see it", async () => {
    await run({ op: "move", x: 50, y: 60, ms: 300, pulse: true });
    expect(host()).not.toBeNull();
    expect(host()!.parentElement).toBe(document.documentElement);
    expect(host()!.shadowRoot).toBeNull();  // closed
    expect(document.body.querySelectorAll("*")).toHaveLength(1);
    expect(document.body.textContent).toBe("Real button");
  });

  it("is the same overlay on every call, and is re-created when the page removes it, at the last position", async () => {
    await run({ op: "move", x: 50, y: 60, ms: 0, pulse: false });
    const first = host();
    await run({ op: "say", text: "Typing..." });
    expect(host()).toBe(first);
    first!.remove();
    await run({ op: "busy" });
    expect(host()).not.toBeNull();
    expect(host()).not.toBe(first);
    expect((globalThis as unknown as { __hermesCursor: { x: number; y: number } }).__hermesCursor).toMatchObject({ x: 50, y: 60 });
  });

  it("first appears at the point it is told, else the middle of the viewport; reduced motion jumps", async () => {
    await run({ op: "busy" });
    expect((globalThis as unknown as { __hermesCursor: { x: number } }).__hermesCursor.x).toBe(innerWidth / 2);
    await run({ op: "move", x: 9, y: 8, ms: 600, pulse: true });  // returns at once: no glide
    expect((globalThis as unknown as { __hermesCursor: { x: number; y: number } }).__hermesCursor).toMatchObject({ x: 9, y: 8 });
  });

  it("hide and show switch the overlay off and on for a screenshot, also after it was re-created", async () => {
    await run({ op: "busy" });
    await run({ op: "hide" });
    expect(host()!.hasAttribute("data-shot")).toBe(true);
    host()!.remove();
    await run({ op: "busy" });
    expect(host()!.hasAttribute("data-shot")).toBe(true);
    await run({ op: "show" });
    expect(host()!.hasAttribute("data-shot")).toBe(false);
  });

  it("hide without an overlay creates nothing", async () => {
    await run({ op: "hide" });
    expect(host()).toBeNull();
  });

  it("a key goes back to the name after its time, and the overlay fades after the idle time", async () => {
    vi.useFakeTimers();
    try {
      await run({ op: "say", text: "Enter", ttl: 1200 });
      const mem = (globalThis as unknown as { __hermesCursor: { o: { wrap: HTMLElement; pill: HTMLElement } } }).__hermesCursor;
      expect(mem.o.pill.textContent).toBe("Enter");
      expect(mem.o.wrap.classList.contains("on")).toBe(true);
      vi.advanceTimersByTime(1300);
      expect(mem.o.pill.textContent).toBe(CURSOR_STYLE.pillText);
      vi.advanceTimersByTime(CURSOR_STYLE.idleMs);
      expect(mem.o.wrap.classList.contains("on")).toBe(false);
      // the frame, the cursor and the "Hermes is using this tab" label all fade out together with the "on" class
      const sheet = (mem.o.wrap.getRootNode() as ShadowRoot).querySelector("style")!.textContent!;
      expect(sheet).toMatch(/\.on \.frame, \.on \.cursor, \.on \.label \{ opacity: 1; \}/);
      expect((mem.o.wrap.getRootNode() as ShadowRoot).textContent).toContain(CURSOR_STYLE.frameText);
    } finally {
      vi.useRealTimers();
    }
  });
});
