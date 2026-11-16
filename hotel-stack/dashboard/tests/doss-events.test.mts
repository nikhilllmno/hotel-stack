import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEvent, failed, sseParser, turnsFromHistory, type Turn } from "../src/lib/doss-events.ts";
import { diffCounts, diffLines } from "../src/lib/diff.ts";

// Shapes recorded from Doss's Hermes API server (session chat stream + stored transcript).
const transcript = [
  { role: "user", content: "How many cabins? Also research events." },
  { role: "assistant", content: "", tool_calls: [{ id: "t1", function: { name: "delegate_task", arguments: '{"tasks":[{"goal":"Find Fredericksburg events"}]}' } }] },
  { role: "tool", tool_call_id: "t1", content: '{"status":"dispatched","mode":"background","delegation_id":"deleg_1"}' },
  { role: "assistant", content: "", tool_calls: [{ id: "t2", function: { name: "tool_call", arguments: '{"calls":[{"name":"mcp__beds24__get_hotel","arguments":{}}]}' } }] },
  { role: "tool", tool_call_id: "t2", content: "15 room types" },
  { role: "assistant", content: "We have 15 units." },
  { role: "user", content: "Write a skill" },
  { role: "assistant", content: "", tool_calls: [{ id: "t3", function: { name: "skill_manage", arguments: '{"action":"patch","name":"daily-report","old_string":"a\\nb","new_string":"a\\nc","api_key":"x"}' } }] },
  { role: "tool", tool_call_id: "t3", content: "ok" },
  { role: "assistant", content: "Done." },
];

test("history becomes turns with steps, subagents, unwrapped tool_call and edits", () => {
  const turns = turnsFromHistory(transcript);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].text, "We have 15 units.");
  const [sub, mcp] = turns[0].steps;
  assert.deepEqual(sub.subagent, { goals: ["Find Fredericksburg events"], delegationId: "deleg_1", background: true });
  assert.equal(mcp.tool, "mcp__beds24__get_hotel");
  assert.equal(mcp.output, "15 room types");
  const edit = turns[1].steps[0];
  assert.deepEqual(edit.edit, { path: "daily-report", before: "a\nb", after: "a\nc" });
  assert.ok(!edit.input.includes("api_key"));
});

test("live events build the running turn, then run.completed takes the transcript", () => {
  let t: Turn = { user: "q", text: "", steps: [], approvals: [], status: "running" };
  t = applyEvent(t, "tool.started", { tool_name: "web_search", args: { query: "fredericksburg events" } });
  assert.equal(t.steps[0].input, "fredericksburg events");
  assert.equal(t.steps[0].status, "running");
  t = applyEvent(t, "tool.completed", { tool_name: "web_search" });
  assert.equal(t.steps[0].status, "done");
  t = applyEvent(t, "approval.request", { run_id: "r1", request_id: "p1", execution_generation: 2, description: "set price", choices: ["once", "deny"] });
  assert.equal(t.approvals[0].generation, 2);
  assert.equal(t.approvals[0].requestId, "p1");
  t = applyEvent(t, "assistant.delta", { delta: "Hi" });
  t = applyEvent(t, "run.completed", { messages: transcript.slice(1, 6), usage: { input_tokens: 10, output_tokens: 2 } });
  assert.equal(t.status, "done");
  assert.equal(t.steps.length, 2);
  assert.equal(t.approvals.length, 1);
});

test("SSE parser handles split chunks and keepalives", () => {
  const got: string[] = [];
  const feed = sseParser((name, d) => got.push(`${name}:${d.x}`));
  feed(": keepalive\n\nevent: a\ndata: {\"x\"");
  feed(":1}\n\nevent: b\ndata: {\"x\":2}\n\n");
  assert.deepEqual(got, ["a:1", "b:2"]);
});

test("line diff counts adds and removals", () => {
  const lines = diffLines("a\nb\nc", "a\nc\nd");
  assert.deepEqual(diffCounts(lines), { added: 1, removed: 1 });
});

test("tool failures are judged by the parsed result, not by the word error", () => {
  assert.equal(failed('{"output": "ok", "exit_code": 0, "error": null}'), false);
  assert.equal(failed('{"output": "", "exit_code": 2, "error": null}'), true);
  assert.equal(failed('{"status": "error", "error": "BLOCKED: no"}'), true);
  assert.equal(failed("BLOCKED: approval required"), true);
  assert.equal(failed("15 room types"), false);
});

test("a finished proposal tool becomes a change card after the reply text", async () => {
  const { toThreadMessages, proposedChangeId } = await import("../src/lib/doss-messages.ts");
  const out = '<untrusted_tool_result source="mcp__hotel__propose_change">{"id": 2, "status": "checking"}</untrusted_tool_result>';
  const step = { id: "s1", tool: "mcp__hotel__propose_change", input: "", args: {}, output: out, status: "done" as const };
  assert.equal(proposedChangeId(step), 2);
  assert.equal(proposedChangeId({ ...step, tool: "mcp__hotel__list_changes" }), null);
  const escaped = '<untrusted_tool_result>{"result": "{\\n  \\"id\\": 7,\\n  \\"status\\": \\"checking\\"}"}</untrusted_tool_result>';
  assert.equal(proposedChangeId({ ...step, output: escaped }), 7);
  const [, assistant] = toThreadMessages([{ user: "q", text: "Proposed #2", steps: [step], approvals: [], status: "done" }]);
  const types = (assistant.content as { type: string }[]).map((p) => p.type);
  assert.deepEqual(types, ["tool-call", "text", "data-hermes_change"]);
});

test("a Hermes clarify prompt becomes a question with the recommended choice marked", async () => {
  const { toQuestion } = await import("../src/lib/doss-events.ts");
  const q = toQuestion({ kind: "clarify", prompt_id: "abc", execution_generation: 1, multi_select: false,
    question: 'Which cabin?\nReply "skip" to skip this question.', choices: ["Cabin 1 (Recommended)", "Cabin 2"] }, "run_1");
  assert.deepEqual(q, { runId: "run_1", requestId: "abc", generation: 1, question: "Which cabin?",
    choices: ["Cabin 1", "Cabin 2"], recommended: "Cabin 1", multi: false });
  const { toThreadMessages } = await import("../src/lib/doss-messages.ts");
  const [, assistant] = toThreadMessages([{ user: "q", text: "", steps: [], approvals: [], questions: [q], status: "running" }]);
  assert.deepEqual((assistant.content as { type: string }[]).map((p) => p.type), ["data-hermes_question"]);
});
