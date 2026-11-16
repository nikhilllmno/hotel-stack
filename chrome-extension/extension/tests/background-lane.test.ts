import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(async () => ({})),
  reload: vi.fn(async () => undefined),
  goBack: vi.fn(async () => undefined),
  goForward: vi.fn(async () => undefined),
  create: vi.fn(async () => ({ id: 9 })),
}));

vi.mock("../src/background/agent-tab", () => ({ getAgentTab: async () => ({ id: 7, url: "https://x.com/" }), adoptTab: async () => undefined }));
// The navigation starts when navigateAndWait runs `start`; the page then "finishes loading" at once.
vi.mock("../src/background/tab-load", () => ({
  navigateAndWait: async (_id: number, start: () => Promise<unknown>) => void (await start()),
  waitForLoad: async (id: number) => ({ id, title: "T", url: "https://new.test/" }),
}));
vi.mock("../src/background/status", () => ({ getStatus: async () => ({}) }));
vi.mock("../src/background/commands/page-line", async (orig) => ({ ...(await orig<object>()), pageLine: async () => "Page is now" }));

const { navigate } = await import("../src/background/commands/navigate");
const { useTab } = await import("../src/background/commands/tabs");
const { enqueue, resetLaneForTest } = await import("../src/background/lane");

beforeEach(() => {
  vi.clearAllMocks();
  resetLaneForTest();
  (globalThis as { chrome?: unknown }).chrome = {
    tabs: { update: mocks.update, reload: mocks.reload, goBack: mocks.goBack, goForward: mocks.goForward, create: mocks.create, get: async (id: number) => ({ id, title: "T", url: "https://x.com/" }) },
  };
});

describe("a stale command changes nothing in Chrome", () => {
  const gone = () => false;
  const stale = /bridge connection changed/;

  it.each([
    ["navigate to a url", { url: "https://new.test/" }, mocks.update],
    ["reload", { to: "reload" as const }, mocks.reload],
    ["back", { to: "back" as const }, mocks.goBack],
    ["forward", { to: "forward" as const }, mocks.goForward],
  ])("%s does not navigate", async (_n, args, call) => {
    await expect(navigate(args, gone)).rejects.toThrow(stale);
    expect(call).not.toHaveBeenCalled();
  });

  it("navigates while the connection is current", async () => {
    await navigate({ url: "https://new.test/" }, () => true);
    expect(mocks.update).toHaveBeenCalledWith(7, { url: "https://new.test/" });
  });

  it("use_tab neither activates a tab nor opens one", async () => {
    await expect(useTab({ tab_id: 3 }, gone)).rejects.toThrow(stale);
    await expect(useTab({ url: "https://new.test/" }, gone)).rejects.toThrow(stale);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("the execution lane", () => {
  const gate = () => {
    let open!: () => void;
    const p = new Promise<void>((r) => (open = r));
    return { p, open };
  };

  it("runs work one after the other, in order, whoever queued it", async () => {
    const first = gate();
    const order: string[] = [];
    const a = enqueue(async () => { order.push("a start"); await first.p; order.push("a end"); });
    const b = enqueue(async () => { order.push("b"); });
    await Promise.resolve();
    expect(order).toEqual(["a start"]);
    first.open();
    await Promise.all([a, b]);
    expect(order).toEqual(["a start", "a end", "b"]);
  });

  it("goes on after work that failed, and passes the failure to its own caller only", async () => {
    const bad = enqueue(async () => { throw new Error("boom"); });
    const good = enqueue(async () => "fine");
    await expect(bad).rejects.toThrow("boom");
    await expect(good).resolves.toBe("fine");
  });
});
