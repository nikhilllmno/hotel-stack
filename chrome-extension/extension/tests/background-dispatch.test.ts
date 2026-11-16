import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandError } from "../src/background/errors";

const handlers = vi.hoisted(() => ({
  act: vi.fn(),
  act_with_approval: vi.fn(),
  snapshot: vi.fn(),
}));
const updateStatus = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../src/background/commands", () => ({ handlers }));
vi.mock("../src/background/status", () => ({ getStatus: async () => ({ bridge: "connected" }), updateStatus }));

const { runCommand } = await import("../src/background/dispatch");

const msg = (name: string, approved: boolean) => ({ type: "command", id: "1", name, args: { action: "click" }, approved }) as never;

beforeEach(() => vi.clearAllMocks());

describe("runCommand", () => {
  it("passes approved=true only to act_with_approval", async () => {
    handlers.act.mockResolvedValue({ text: "ok" });
    handlers.act_with_approval.mockResolvedValue({ text: "ok" });
    await runCommand(msg("act", true));
    expect(handlers.act).toHaveBeenCalledWith({ action: "click" }, false);
    await runCommand(msg("act_with_approval", true));
    expect(handlers.act_with_approval).toHaveBeenCalledWith({ action: "click" }, true);
  });

  it("wraps output into a result and records lastAction", async () => {
    handlers.snapshot.mockResolvedValue({ text: "line one\nline two", status: "needs_approval" });
    const result = await runCommand(msg("snapshot", false));
    expect(result).toMatchObject({ type: "result", id: "1", ok: true, status: "needs_approval", text: "line one\nline two" });
    expect(updateStatus).toHaveBeenCalledWith(expect.objectContaining({ lastAction: expect.objectContaining({ name: "snapshot", summary: "line one", status: "needs_approval" }) }));
  });

  it("turns a CommandError into the error sentence", async () => {
    handlers.snapshot.mockRejectedValue(new CommandError("Element e1 is gone. Take a new snapshot."));
    expect(await runCommand(msg("snapshot", false))).toEqual({ type: "result", id: "1", ok: false, error: "Element e1 is gone. Take a new snapshot." });
  });

  it("names the command when something unexpected fails, and for unknown commands", async () => {
    handlers.snapshot.mockRejectedValue(new Error("boom"));
    expect(await runCommand(msg("snapshot", false))).toMatchObject({ ok: false, error: "The Hermes extension failed on 'snapshot': boom" });
    expect(await runCommand(msg("teleport", false))).toMatchObject({ ok: false, error: expect.stringContaining("does not know the command 'teleport'") });
  });
});
