import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cdp: vi.fn(),
  hide: vi.fn(async () => undefined),
  show: vi.fn(async () => undefined),
  viewport: { pageX: 0, pageY: 0, clientWidth: 1000, clientHeight: 800 },
}));

vi.mock("../src/background/agent-tab", () => ({ getWorkableTab: async () => ({ id: 7, url: "https://x.com/", title: "T" }) }));
vi.mock("../src/background/debugger", () => ({ cdp: mocks.cdp }));
vi.mock("../src/background/cursor", () => ({ cursor: { hide: mocks.hide, show: mocks.show } }));
vi.mock("../src/background/input", () => ({ visualViewport: async () => mocks.viewport }));

const { screenshot } = await import("../src/background/commands/screenshot");

/** `dpr` for Runtime.evaluate; `size(params)` decides how many base64 characters a capture returns. */
function chrome(dpr: number, size: (p: { format: string; quality?: number; clip: { scale: number } }) => number = () => 100) {
  mocks.cdp.mockImplementation(async (_tab: unknown, method: string, params: never) => {
    if (method === "Runtime.evaluate") return { result: { value: dpr } };
    return { data: "A".repeat(size(params)) };
  });
}
const captures = () => mocks.cdp.mock.calls.filter((c) => c[1] === "Page.captureScreenshot").map((c) => c[2] as { format: string; quality?: number; clip: { scale: number; width: number } });

beforeEach(() => {
  mocks.cdp.mockReset();
  mocks.hide.mockClear();
  mocks.show.mockClear();
  mocks.viewport = { pageX: 0, pageY: 0, clientWidth: 1000, clientHeight: 800 };
});

describe("screenshot and the agent cursor", () => {
  it("hides the cursor before the capture and shows it again afterwards", async () => {
    const order: string[] = [];
    mocks.hide.mockImplementation(async () => void order.push("hide"));
    mocks.show.mockImplementation(async () => void order.push("show"));
    mocks.cdp.mockImplementation(async (_t: unknown, method: string) => {
      order.push(method);
      return method === "Runtime.evaluate" ? { result: { value: 1 } } : { data: "A" };
    });
    await screenshot();
    expect(order[0]).toBe("hide");
    expect(order.indexOf("Page.captureScreenshot")).toBeGreaterThan(0);
    expect(order.at(-1)).toBe("show");
  });

  it("shows it again when the capture fails", async () => {
    mocks.cdp.mockRejectedValue(new Error("no capture"));
    await expect(screenshot()).rejects.toThrow("no capture");
    expect(mocks.hide).toHaveBeenCalledOnce();
    expect(mocks.show).toHaveBeenCalledOnce();
  });
});

describe("screenshot", () => {
  it("at device pixel ratio 1 captures at clip scale 1 and says pixels equal CSS pixels", async () => {
    chrome(1);
    const out = await screenshot();
    expect(captures()[0].clip.scale).toBe(1);
    expect(out.text).toContain("(1000x800 px)");
    expect(out.text).toContain("Image pixels equal viewport CSS pixels");
    expect(out.image?.mime).toBe("image/png");
  });

  it("at device pixel ratio 2 halves the clip scale so the image is in CSS pixels, and the caption stays true", async () => {
    chrome(2);
    const out = await screenshot();
    expect(captures()[0].clip.scale).toBe(0.5);
    expect(out.text).toContain("(1000x800 px)");
    expect(out.text).toContain("Image pixels equal viewport CSS pixels");
    expect(out.text).not.toContain("multiply");
  });

  it("at device pixel ratio 2 with a wide viewport scales to 1600 px and states the multiplier", async () => {
    mocks.viewport = { pageX: 0, pageY: 0, clientWidth: 3200, clientHeight: 1600 };
    chrome(2);
    const out = await screenshot();
    expect(captures()[0].clip.scale).toBe(0.25);        // 0.5 (fit) / 2 (dpr)
    expect(out.text).toContain("(1600x800 px)");
    expect(out.text).toContain("viewport is 3200x1600 CSS px; multiply image coordinates by 2.00");
  });

  it("falls back to 1 when the page does not report a device pixel ratio", async () => {
    mocks.cdp.mockImplementation(async (_t: unknown, method: string) => (method === "Runtime.evaluate" ? {} : { data: "A" }));
    await screenshot();
    expect(captures()[0].clip.scale).toBe(1);
  });

  it("falls back to JPEG when the PNG is over 8 MB of base64", async () => {
    chrome(1, (p) => (p.format === "png" ? 8_000_001 : 3_000_000));
    const out = await screenshot();
    expect(captures().map((c) => c.format)).toEqual(["png", "jpeg"]);
    expect(captures()[1].quality).toBe(80);
    expect(out.image?.mime).toBe("image/jpeg");
    expect(out.image!.data.length).toBeLessThanOrEqual(8_000_000);
    expect(out.text).toContain("JPEG");
    expect(out.text).toContain("Image pixels equal viewport CSS pixels");
  });

  it("lowers the quality, then shrinks the image, and states the new scale", async () => {
    // only the half-size capture fits
    chrome(1, (p) => (p.clip.scale <= 0.5 ? 1_000_000 : 9_000_000));
    const out = await screenshot();
    expect(captures().map((c) => [c.format, c.quality, c.clip.scale])).toEqual([
      ["png", undefined, 1],
      ["jpeg", 80, 1],
      ["jpeg", 60, 1],
      ["jpeg", 50, 0.7],
      ["jpeg", 40, 0.5],
    ]);
    expect(out.text).toContain("(500x400 px)");
    expect(out.text).toContain("multiply image coordinates by 2.00");
  });

  it("keeps the PNG when it fits", async () => {
    chrome(1, () => 7_999_999);
    await screenshot();
    expect(captures()).toHaveLength(1);
  });

  it("gives up with a sentence when nothing fits", async () => {
    chrome(1, () => 9_000_000);
    await expect(screenshot()).rejects.toThrow(/too large to send/);
  });
});
