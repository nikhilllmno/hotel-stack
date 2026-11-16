/**
 * Turns Hermes events and stored transcripts into chat turns with steps. Adapted from the dashboard's
 * hotel-stack/dashboard/src/lib/doss-events.ts (keep the protocol parts in sync), with friendly labels for the
 * `chrome` bridge tools and without the dashboard-only parts (diffs, subagents, proposals).
 */

import type { HermesErrorKind } from "./hermes-client";

export type StepKind = "navigate" | "act" | "type" | "screenshot" | "snapshot" | "tabs" | "wait" | "other";

export type Step = {
  id: string;
  tool: string;
  kind: StepKind;
  label: string;            // "Clicked 'Search'", "Read the page", "Opened beds24.com"
  input: string;            // short, redacted summary of the arguments
  args: Record<string, unknown>;
  output?: string;
  status: "running" | "done" | "error";
  via?: string;             // set when the call came inside a `tool_call` batch: the batch's tool name
};

export type Approval = {
  runId: string; requestId: string; generation: number;
  command: string; description: string; choices: string[];
};

/** One open question from Hermes (clarify), polled from the run's pending_controls. */
export type Question = {
  runId: string; requestId: string; generation: number;
  question: string; choices: string[]; recommended?: string; multi: boolean;
};

export type Turn = {
  user: string;
  text: string;
  steps: Step[];
  approvals: Approval[];
  questions?: Question[];
  status: "running" | "done" | "failed" | "cancelled";
  error?: string;
  errorKind?: HermesErrorKind;
};

export type Msg = {
  role: string; content?: string | null; tool_call_id?: string | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[] | null;
};

const SECRET = /key|token|secret|password|auth/i;
const KEY_FIELDS = ["query", "url", "text", "key", "ref", "to", "ms", "path", "name", "command", "action", "target", "goal"];

/** One-line input hint, without secrets. */
export function summarize(tool: string, args: Record<string, unknown>): string {
  if (tool === "clarify") {
    return ((args.questions as { question?: string }[] | undefined) ?? []).map((q) => q.question ?? "").join(" | ").slice(0, 120);
  }
  if (tool === "tool_call") {
    return ((args.calls as { name: string }[] | undefined) ?? []).map((c) => c.name.replace(/^mcp_+/, "")).join(", ");
  }
  for (const k of KEY_FIELDS) {
    const v = args[k];
    if (v !== undefined && !SECRET.test(k)) return (Array.isArray(v) ? v.join(", ") : String(v)).slice(0, 120);
  }
  const safe = Object.fromEntries(Object.entries(args).filter(([k]) => !SECRET.test(k)));
  return Object.keys(safe).length ? JSON.stringify(safe).slice(0, 120) : "";
}

const CHROME_TOOLS = ["tabs", "use_tab", "navigate", "snapshot", "screenshot", "act_with_approval", "act", "wait"] as const;
type ChromeTool = (typeof CHROME_TOOLS)[number];

/** `mcp_chrome_snapshot` / `mcp__chrome__snapshot` / `chrome_snapshot` -> "snapshot" (matches on the suffix). */
export function chromeTool(name: string): ChromeTool | undefined {
  const m = name.match(/(?:^|_)chrome_{1,2}([a-z_]+)$/);
  return CHROME_TOOLS.find((t) => t === m?.[1]);
}

const short = (tool: string) => tool.replace(/^mcp_+/, "").replace(/_{2,}/g, " / ");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));

function host(url: string): string {
  try { return new URL(/^[a-z]+:/i.test(url) ? url : `https://${url}`).host.replace(/^www\./, ""); } catch { return clip(url, 40); }
}

/** The bridge tool's text out of whatever Hermes stored (plain text, or a JSON wrapper with result/content). */
export function toolText(output: string | undefined): string {
  if (!output) return "";
  try {
    const j = JSON.parse(output);
    if (typeof j === "string") return j;
    const inner = j?.result ?? j?.text ?? j?.output;
    if (typeof inner === "string") return inner;
    if (Array.isArray(j?.content)) return j.content.map((p: { text?: string }) => p.text ?? "").join("\n");
  } catch { /* plain text */ }
  return output;
}

/** Icon kind and one-line label for a step. The tool text (once known) names the element: "Clicked button 'Search'". */
export function describeStep(tool: string, args: Record<string, unknown>, output?: string): { kind: StepKind; label: string } {
  const c = chromeTool(tool);
  if (!c) return { kind: "other", label: `Used ${short(tool)}` };
  const text = toolText(output);
  switch (c) {
    case "snapshot": return { kind: "snapshot", label: "Read the page" };
    case "screenshot": return { kind: "screenshot", label: "Took a screenshot" };
    case "tabs": return { kind: "tabs", label: "Listed open tabs" };
    case "wait": return { kind: "wait", label: args.text ? `Waited for "${clip(str(args.text), 30)}"` : `Waited ${Math.round(Number(args.ms ?? 1000)) / 1000}s` };
    case "navigate": {
      const to = str(args.to);
      if (to === "back") return { kind: "navigate", label: "Went back" };
      if (to === "forward") return { kind: "navigate", label: "Went forward" };
      if (to === "reload") return { kind: "navigate", label: "Reloaded the page" };
      return { kind: "navigate", label: args.url ? `Opened ${host(str(args.url))}` : "Navigated" };
    }
    case "use_tab": {
      if (args.url) return { kind: "navigate", label: `Opened ${host(str(args.url))} in a new tab` };
      return { kind: "navigate", label: "Switched tab" };
    }
    case "act":
    case "act_with_approval": {
      const action = str(args.action);
      const ref = str(args.ref);
      const named = text.match(/^(?:Not done: )?(Clicked|Typed|Pressed|Selected|Hovered|Scrolled)\b[^'"\n]*?['"]([^'"\n]+)['"]/i);
      const what = named ? `'${clip(named[2], 40)}'` : ref ? ref : args.x !== undefined ? `at (${str(args.x)}, ${str(args.y)})` : "";
      switch (action) {
        case "type": return { kind: "type", label: `Typed "${clip(str(args.text), 30)}"${named ? ` in ${what}` : ""}` };
        case "press": return { kind: "type", label: `Pressed ${str(args.key) || "a key"}` };
        case "scroll": return { kind: "act", label: `Scrolled ${str(args.direction) || "down"}` };
        case "select": return { kind: "act", label: `Selected "${clip(str(args.text), 30)}"` };
        case "hover": return { kind: "act", label: `Hovered ${what}`.trim() };
        default: return { kind: "act", label: `Clicked ${what}`.trim() };
      }
    }
  }
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  try { return JSON.parse(String(raw ?? "{}")); } catch { return {}; }
}

export function makeStep(id: string, tool: string, rawArgs: unknown, output?: string, status: Step["status"] = "running", via?: string): Step {
  const args = parseArgs(rawArgs);
  return { id, tool, args, input: summarize(tool, args), output, status, via, ...describeStep(tool, args, output) };
}

/** A tool result failed if it says so: status "error", a non-null error, a non-zero exit code, or "Error..." text. */
export function failed(output: string): boolean {
  const r = parseArgs(output);
  if (Object.keys(r).length) return r.status === "error" || Boolean(r.error) || (typeof r.exit_code === "number" && r.exit_code !== 0);
  return /^(error|blocked)/i.test(output.trim());
}

/** Steps from a stored transcript slice: assistant tool_calls joined with their tool results by call id. */
export function stepsFromMessages(messages: Msg[]): Step[] {
  const outputs = new Map(messages.filter((m) => m.role === "tool").map((m) => [m.tool_call_id ?? "", m.content ?? ""]));
  return messages.flatMap((m) => (m.tool_calls ?? []).flatMap((c) => {
    const out = outputs.get(c.id);
    const status = out === undefined ? "running" : failed(out) ? "error" : "done";
    if (c.function.name !== "tool_call") return [makeStep(c.id, c.function.name, c.function.arguments, out, status)];
    // Hermes' tool_call meta-tool batches real calls (e.g. MCP tools): show each one, sharing the batch output.
    const calls = (parseArgs(c.function.arguments).calls as { name: string; arguments: unknown }[] | undefined) ?? [];
    return calls.map((inner, i) => makeStep(`${c.id}-${i}`, inner.name, inner.arguments, out, status, "tool_call"));
  }));
}

/** Rebuild turns from a session's stored messages (each user message starts a turn). */
export function turnsFromHistory(messages: Msg[]): Turn[] {
  const turns: Turn[] = [];
  let slice: Msg[] = [];
  const close = () => {
    if (!turns.length) return;
    const t = turns[turns.length - 1];
    t.steps = stepsFromMessages(slice);
    t.text = [...slice].reverse().find((m) => m.role === "assistant" && m.content)?.content ?? "";
  };
  for (const m of messages) {
    if (m.role === "user") {
      close();
      turns.push({ user: m.content ?? "", text: "", steps: [], approvals: [], status: "done" });
      slice = [];
    } else slice.push(m);
  }
  close();
  return turns;
}

/** Apply one SSE event from /api/sessions/{id}/chat/stream to the running turn (returns a new turn). */
export function applyEvent(turn: Turn, name: string, d: Record<string, unknown>): Turn {
  const t = { ...turn, steps: [...turn.steps], approvals: [...turn.approvals] };
  switch (name) {
    case "assistant.delta":
      t.text += String(d.delta ?? "");
      break;
    case "tool.started": {
      const tool = String(d.tool_name);
      const calls = tool === "tool_call" ? ((parseArgs(d.args).calls as { name: string; arguments: unknown }[] | undefined) ?? []) : [];
      if (calls.length) calls.forEach((c) => t.steps.push(makeStep(`live-${t.steps.length}`, c.name, c.arguments, undefined, "running", tool)));
      else t.steps.push(makeStep(`live-${t.steps.length}`, tool, d.args));
      break;
    }
    case "tool.completed":
    case "tool.failed": {
      const status = name === "tool.failed" ? "error" : "done";
      const output = typeof d.output === "string" ? d.output : typeof d.result === "string" ? d.result : undefined;
      const mine = (s: Step) => s.status === "running" && (s.tool === d.tool_name || s.via === d.tool_name);
      const batch = t.steps.some((s) => mine(s) && s.via);
      t.steps = t.steps.map((s, i) => {
        if (!mine(s)) return s;
        // A plain call closes the oldest running step of that tool; a batch closes all of its calls.
        if (!batch && i !== t.steps.findIndex(mine)) return s;
        return { ...s, status, ...(output === undefined ? {} : { output, ...describeStep(s.tool, s.args, output) }) };
      });
      break;
    }
    case "approval.request":
      t.approvals.push({
        runId: String(d.run_id), requestId: String(d.request_id ?? d.prompt_id),  // session stream: request_id; runs stream: prompt_id
        generation: Number(d.execution_generation),
        command: String(d.command ?? ""), description: String(d.description ?? ""), choices: (d.choices as string[]) ?? ["once", "deny"],
      });
      break;
    case "assistant.completed":
      if (d.content) t.text = String(d.content);
      break;
    case "run.completed": {
      const msgs = (d.messages as Msg[] | undefined) ?? [];
      if (msgs.length) t.steps = stepsFromMessages(msgs);
      t.status = "done";
      break;
    }
    case "run.failed":
      t.status = "failed";
      t.error = String(d.error ?? name);
      break;
    case "run.cancelled":
      t.status = "cancelled";
      t.error = String(d.error ?? "Stopped");
      break;
  }
  return t;
}

/** Minimal SSE parser: feed text chunks, get back complete {name, data} events. */
export function sseParser(onEvent: (name: string, data: Record<string, unknown>) => void) {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk.replace(/\r\n/g, "\n");
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let name = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (!data.length) continue;
      try { onEvent(name, JSON.parse(data.join("\n"))); } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
    }
  };
}

/** A Hermes clarify prompt -> Question: drops the "Reply skip" hint, marks and unwraps the recommended choice. */
export function toQuestion(p: Record<string, unknown>, runId: string): Question {
  const raw = (p.choices as string[] | undefined) ?? [];
  const recommended = raw.find((c) => c.endsWith(" (Recommended)"))?.replace(/ \(Recommended\)$/, "");
  return {
    runId, requestId: String(p.prompt_id), generation: Number(p.execution_generation),
    question: String(p.question ?? "").split("\n").filter((l) => !/^Reply "skip"/.test(l)).join("\n").trim(),
    choices: raw.map((c) => c.replace(/ \(Recommended\)$/, "")), recommended, multi: Boolean(p.multi_select),
  };
}

export type ApprovalSummary = { action: string; element?: string; reason?: string; detail?: string };

/**
 * What the owner is asked to allow, from the approval description/command. For the bridge's `act_with_approval` the
 * command carries "Arguments:" + JSON ({action, ref, text, key, reason ...}); the rest is shown as plain text.
 */
export function parseApproval(a: Pick<Approval, "command" | "description">): ApprovalSummary {
  const both = `${a.command}\n${a.description}`;
  const json = both.match(/Arguments:\s*(\{[\s\S]*\})/)?.[1];
  let args: Record<string, unknown> | undefined;
  if (json) { try { args = JSON.parse(json); } catch { /* truncated: fall back to text */ } }
  if (!args) return { action: clip(a.description || a.command, 300) };
  const act = str(args.action) || "act";
  const target = args.ref ? `element ${str(args.ref)}` : args.x !== undefined ? `point (${str(args.x)}, ${str(args.y)})` : undefined;
  const verbs: Record<string, string> = { click: "Click", type: "Type", press: "Press", scroll: "Scroll", select: "Select", hover: "Hover over" };
  const verb = verbs[act] ?? act;
  const detail = act === "type" || act === "select" ? str(args.text) : act === "press" ? str(args.key) : act === "scroll" ? str(args.direction) : "";
  return { action: verb, element: target, reason: str(args.reason) || undefined, detail: detail ? clip(detail, 120) : undefined };
}
