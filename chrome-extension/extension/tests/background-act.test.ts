import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ElementFacts } from "../src/background/risk";

const mocks = vi.hoisted(() => ({
  callPage: vi.fn(),
  mouseClick: vi.fn(async () => undefined),
  mouseMove: vi.fn(async () => undefined),
  insertText: vi.fn(async () => undefined),
  pressKey: vi.fn(async () => undefined),
  wheel: vi.fn(async () => undefined),
}));

vi.mock("../src/background/agent-tab", () => ({ getWorkableTab: async () => ({ id: 7, url: "https://x.com/" }) }));
vi.mock("../src/background/page-call", () => ({ callPage: mocks.callPage }));
vi.mock("../src/background/input", () => ({
  mouseClick: mocks.mouseClick, mouseMove: mocks.mouseMove, insertText: mocks.insertText, pressKey: mocks.pressKey, wheel: mocks.wheel,
  visualViewport: async () => ({ pageX: 0, pageY: 0, clientWidth: 1000, clientHeight: 800 }),
}));
vi.mock("../src/background/tab-load", () => ({ settle: async () => undefined }));
vi.mock("../src/background/commands/page-line", () => ({ pageLine: async () => 'Page is now "T" https://x.com/' }));

const { act } = await import("../src/background/commands/act");

const facts = (over: Partial<ElementFacts>): ElementFacts => ({ tag: "button", role: "button", name: "Search", inForm: false, pageHost: "x.com", ...over });
const located = (f: ElementFacts) => ({ found: true, x: 10, y: 20, facts: f });

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { chrome?: unknown }).chrome = { tabs: { onCreated: { addListener: vi.fn(), removeListener: vi.fn() } } };
});

describe("act", () => {
  it("clicks a safe element with a trusted mouse event and summarises", async () => {
    mocks.callPage.mockResolvedValueOnce(located(facts({})));
    const out = await act({ action: "click", ref: "e1" }, false);
    expect(mocks.mouseClick).toHaveBeenCalledWith({ id: 7, url: "https://x.com/" }, 10, 20);
    expect(out).toEqual({ status: "done", text: 'Clicked button "Search". Page is now "T" https://x.com/' });
  });

  it("refuses a submit button with needs_approval and does not click", async () => {
    mocks.callPage.mockResolvedValueOnce(located(facts({ type: "submit", name: "Save booking", inForm: true })));
    const out = await act({ action: "click", ref: "e5" }, false);
    expect(out.status).toBe("needs_approval");
    expect(out.text).toBe(
      "Not done: this click needs the owner's approval (submits a form: \"Save booking\"). Call act_with_approval with the same arguments and a short reason.",
    );
    expect(mocks.mouseClick).not.toHaveBeenCalled();
  });

  it("clicks the same button when approved", async () => {
    mocks.callPage.mockResolvedValueOnce(located(facts({ type: "submit", name: "Save booking", inForm: true })));
    const out = await act({ action: "click", ref: "e5", reason: "owner said so" }, true);
    expect(out.status).toBe("done");
    expect(mocks.mouseClick).toHaveBeenCalledOnce();
  });

  it("blocks typing into a password field even when approved", async () => {
    mocks.callPage.mockResolvedValueOnce(located(facts({ tag: "input", type: "password", role: "textbox", name: "Password", editable: true })));
    const out = await act({ action: "type", ref: "e3", text: "hunter2" }, true);
    expect(out.status).toBe("blocked");
    expect(mocks.insertText).not.toHaveBeenCalled();
  });

  it("types after focusing and clearing the field", async () => {
    mocks.callPage
      .mockResolvedValueOnce(located(facts({ tag: "input", type: "text", role: "textbox", name: "Guest", editable: true })))
      .mockResolvedValueOnce({ found: true, hadText: true });
    const out = await act({ action: "type", ref: "e2", text: "Ada" }, false);
    expect(mocks.callPage).toHaveBeenLastCalledWith(expect.anything(), { op: "focus", ref: "e2", clear: true });
    expect(mocks.pressKey).toHaveBeenCalledWith(expect.anything(), "Backspace");
    expect(mocks.insertText).toHaveBeenCalledWith(expect.anything(), "Ada");
    expect(out.text).toContain('Typed 3 characters into textbox "Guest".');
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

  it("presses Enter on the focused element, asking first inside a form", async () => {
    mocks.callPage.mockResolvedValueOnce(facts({ tag: "input", type: "text", role: "textbox", name: "Guest", inForm: true, editable: true }));
    const out = await act({ action: "press", key: "Enter" }, false);
    expect(out.status).toBe("needs_approval");
    expect(mocks.pressKey).not.toHaveBeenCalled();
  });

  it("scrolls the page centre by one screen by default", async () => {
    mocks.callPage.mockResolvedValueOnce(facts({ tag: "body", role: "clickable", name: "" }));
    await act({ action: "scroll", direction: "down" }, false);
    expect(mocks.wheel).toHaveBeenCalledWith(expect.anything(), 500, 400, 0, 800);
  });
});
