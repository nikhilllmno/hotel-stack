import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cdp: vi.fn(async () => undefined) }));
vi.mock("../src/background/debugger", () => ({ cdp: mocks.cdp }));

const { mouseClick, mouseMove } = await import("../src/background/input");
const tab = { id: 7, url: "https://example.com/" };

describe("visible cursor feedback", () => {
  const executeScript = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    executeScript.mockResolvedValue([]);
    (globalThis as { chrome?: unknown }).chrome = { scripting: { executeScript } };
  });

  it("animates the pointer to a click target before dispatching trusted input", async () => {
    await mouseClick(tab, 10, 20);
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 7 }, world: "ISOLATED", args: [{ x: 10, y: 20, click: true }],
    }));
    expect(mocks.cdp).toHaveBeenNthCalledWith(1, tab, "Input.dispatchMouseEvent", expect.objectContaining({ type: "mousePressed", x: 10, y: 20 }));
    expect(mocks.cdp).toHaveBeenNthCalledWith(2, tab, "Input.dispatchMouseEvent", expect.objectContaining({ type: "mouseReleased", x: 10, y: 20 }));
  });

  it("keeps trusted input working if the transient overlay cannot be injected", async () => {
    executeScript.mockRejectedValueOnce(new Error("tab navigated"));
    await mouseMove(tab, 8, 9);
    expect(mocks.cdp).toHaveBeenCalledWith(tab, "Input.dispatchMouseEvent", { type: "mouseMoved", x: 8, y: 9 });
  });
});
