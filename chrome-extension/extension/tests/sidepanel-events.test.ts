import { describe, expect, it } from "vitest";
import { applyEvent, chromeTool, describeStep, parseApproval, stepsFromMessages, toQuestion, turnsFromHistory, type Turn } from "../src/lib/hermes-events";

const fresh = (): Turn => ({ user: "hi", text: "", steps: [], approvals: [], status: "running" });
const run = (events: [string, Record<string, unknown>][]) => events.reduce((t, [n, d]) => applyEvent(t, n, d), fresh());

describe("chrome tool names", () => {
  it("matches on the suffix, however the prefix looks", () => {
    expect(chromeTool("mcp_chrome_snapshot")).toBe("snapshot");
    expect(chromeTool("mcp__chrome__act_with_approval")).toBe("act_with_approval");
    expect(chromeTool("chrome_act")).toBe("act");
    expect(chromeTool("mcp_hotel_snapshot")).toBeUndefined();
    expect(chromeTool("terminal")).toBeUndefined();
  });

  it("labels each bridge tool", () => {
    expect(describeStep("mcp_chrome_snapshot", {})).toEqual({ kind: "snapshot", label: "Read the page" });
    expect(describeStep("mcp_chrome_screenshot", {})).toEqual({ kind: "screenshot", label: "Took a screenshot" });
    expect(describeStep("mcp_chrome_navigate", { url: "https://www.beds24.com/control3.php" })).toEqual({ kind: "navigate", label: "Opened beds24.com" });
    expect(describeStep("mcp_chrome_navigate", { to: "back" }).label).toBe("Went back");
    expect(describeStep("mcp_chrome_tabs", {}).label).toBe("Listed open tabs");
    expect(describeStep("mcp_chrome_wait", { ms: 2500 }).label).toBe("Waited 2.5s");
    expect(describeStep("mcp_chrome_wait", { text: "Results" }).label).toBe('Waited for "Results"');
    expect(describeStep("mcp_chrome_use_tab", { url: "https://booking.com" }).label).toBe("Opened booking.com in a new tab");
  });

  it("labels act by action, naming the element once the tool text says it", () => {
    expect(describeStep("mcp_chrome_act", { action: "click", ref: "e12" })).toEqual({ kind: "act", label: "Clicked e12" });
    expect(describeStep("mcp_chrome_act", { action: "click", ref: "e12" }, "Clicked button 'Search'. Page is now X https://x")).toEqual({ kind: "act", label: "Clicked 'Search'" });
    expect(describeStep("mcp_chrome_act", { action: "click", ref: "e12" }, JSON.stringify({ result: "Clicked button 'Search'. Page is now X" })).label).toBe("Clicked 'Search'");
    expect(describeStep("mcp_chrome_act", { action: "type", ref: "e3", text: "2026-11-20" })).toEqual({ kind: "type", label: 'Typed "2026-11-20"' });
    expect(describeStep("mcp_chrome_act", { action: "press", key: "Enter" })).toEqual({ kind: "type", label: "Pressed Enter" });
    expect(describeStep("mcp_chrome_act", { action: "scroll", direction: "down" }).label).toBe("Scrolled down");
    expect(describeStep("mcp_chrome_act", { action: "click", x: 10, y: 20 }).label).toBe("Clicked at (10, 20)");
    expect(describeStep("mcp_chrome_act_with_approval", { action: "click", ref: "e9", reason: "send" }).kind).toBe("act");
  });

  it("falls back to a generic label for other tools", () => {
    expect(describeStep("mcp__hotel__bookings", {})).toEqual({ kind: "other", label: "Used hotel / bookings" });
    expect(describeStep("terminal", {})).toEqual({ kind: "other", label: "Used terminal" });
  });
});

describe("applyEvent", () => {
  it("streams text, then replaces it with the completed content", () => {
    let t = run([["assistant.delta", { delta: "Hel" }], ["assistant.delta", { delta: "lo" }]]);
    expect(t.text).toBe("Hello");
    t = applyEvent(t, "assistant.completed", { content: "Hello there" });
    expect(t.text).toBe("Hello there");
  });

  it("tracks chrome steps from start to completion", () => {
    let t = run([
      ["tool.started", { tool_name: "mcp_chrome_snapshot", args: {} }],
      ["tool.started", { tool_name: "mcp_chrome_act", args: { action: "click", ref: "e12" } }],
    ]);
    expect(t.steps.map((s) => [s.kind, s.status])).toEqual([["snapshot", "running"], ["act", "running"]]);
    t = applyEvent(t, "tool.completed", { tool_name: "mcp_chrome_snapshot" });
    expect(t.steps.map((s) => s.status)).toEqual(["done", "running"]);
    t = applyEvent(t, "tool.failed", { tool_name: "mcp_chrome_act" });
    expect(t.steps.map((s) => s.status)).toEqual(["done", "error"]);
  });

  it("closes only the oldest running step of a tool", () => {
    let t = run([["tool.started", { tool_name: "mcp_chrome_act", args: { action: "click", ref: "e1" } }], ["tool.started", { tool_name: "mcp_chrome_act", args: { action: "click", ref: "e2" } }]]);
    t = applyEvent(t, "tool.completed", { tool_name: "mcp_chrome_act" });
    expect(t.steps.map((s) => s.status)).toEqual(["done", "running"]);
  });

  it("unwraps tool_call batches into one step per call and closes them together", () => {
    let t = applyEvent(fresh(), "tool.started", {
      tool_name: "tool_call",
      args: { calls: [{ name: "mcp_chrome_snapshot", arguments: {} }, { name: "mcp_chrome_screenshot", arguments: {} }] },
    });
    expect(t.steps.map((s) => s.label)).toEqual(["Read the page", "Took a screenshot"]);
    t = applyEvent(t, "tool.completed", { tool_name: "tool_call" });
    expect(t.steps.map((s) => s.status)).toEqual(["done", "done"]);
  });

  it("collects approval requests (session stream uses request_id, runs stream prompt_id)", () => {
    const t = run([
      ["approval.request", { run_id: "r1", request_id: "a1", execution_generation: 2, command: "c", description: "d" }],
      ["approval.request", { run_id: "r1", prompt_id: "a2", execution_generation: 2 }],
    ]);
    expect(t.approvals.map((a) => [a.requestId, a.generation, a.choices])).toEqual([["a1", 2, ["once", "deny"]], ["a2", 2, ["once", "deny"]]]);
  });

  it("run.completed rebuilds steps from the transcript, with the element names from the tool text", () => {
    const messages = [
      { role: "user", content: "x" },
      { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "mcp_chrome_act", arguments: JSON.stringify({ action: "click", ref: "e12" }) } }] },
      { role: "tool", tool_call_id: "c1", content: "Clicked button 'Search'. Page is now Results https://x" },
    ];
    const t = applyEvent(applyEvent(fresh(), "tool.started", { tool_name: "mcp_chrome_act", args: { action: "click", ref: "e12" } }), "run.completed", { messages });
    expect(t.status).toBe("done");
    expect(t.steps).toHaveLength(1);
    expect(t.steps[0]).toMatchObject({ label: "Clicked 'Search'", status: "done" });
  });

  it("marks failed and cancelled runs", () => {
    expect(run([["run.failed", { error: "boom" }]])).toMatchObject({ status: "failed", error: "boom" });
    expect(run([["run.cancelled", {}]])).toMatchObject({ status: "cancelled" });
  });
});

describe("history", () => {
  it("builds one turn per user message with its steps and last assistant text", () => {
    const turns = turnsFromHistory([
      { role: "user", content: "[From the Hermes Chrome extension. Current tab: \"A\" https://a.com. Use the chrome tools to act in this browser.]\n\nhello" },
      { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "mcp_chrome_snapshot", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "url: https://a.com" },
      { role: "assistant", content: "Done." },
      { role: "user", content: "again" },
      { role: "assistant", content: "Ok." },
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0].steps[0]).toMatchObject({ kind: "snapshot", status: "done" });
    expect(turns[0].text).toBe("Done.");
    expect(turns[1].text).toBe("Ok.");
  });

  it("flags a tool error and an unfinished call", () => {
    const steps = stepsFromMessages([
      { role: "assistant", content: "", tool_calls: [{ id: "a", function: { name: "mcp_chrome_act", arguments: "{}" } }, { id: "b", function: { name: "mcp_chrome_wait", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "a", content: "Error: Element e1 is gone. Take a new snapshot." },
    ]);
    expect(steps.map((s) => s.status)).toEqual(["error", "running"]);
  });
});

describe("clarify and approval text", () => {
  it("toQuestion drops the skip hint and unwraps the recommended choice", () => {
    const q = toQuestion({ prompt_id: "p1", execution_generation: 3, question: 'Which hotel?\nReply "skip" to skip.', choices: ["Ranch (Recommended)", "Lodge"], multi_select: false }, "r1");
    expect(q).toMatchObject({ requestId: "p1", generation: 3, question: "Which hotel?", choices: ["Ranch", "Lodge"], recommended: "Ranch", multi: false });
  });

  it("parseApproval reads the arguments Hermes puts in the prompt", () => {
    const command = `MCP tool 'act_with_approval' on UNTRUSTED server 'chrome' wants to run. This tool is write-capable.\n\nArguments:\n${JSON.stringify({ action: "click", ref: "e7", reason: "Send the reply to the guest" }, null, 2)}`;
    expect(parseApproval({ command, description: "Server 'chrome' is configured 'trust: untrusted'." })).toEqual({
      action: "Click", element: "element e7", reason: "Send the reply to the guest", detail: undefined,
    });
    const typed = parseApproval({ command: `Arguments:\n{"action":"type","ref":"e3","text":"hello","reason":"r"}`, description: "" });
    expect(typed).toMatchObject({ action: "Type", detail: "hello" });
  });

  it("parseApproval falls back to the plain text", () => {
    expect(parseApproval({ command: "", description: "Run something" })).toEqual({ action: "Run something" });
  });
});
