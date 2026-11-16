/**
 * Turns Hermes events and stored transcripts into chat turns with steps: the dashboard's port of the
 * claude-cookbooks agent_visualizer (live activity + timeline), for Hermes instead of the Agent SDK.
 */

export type Edit = { path: string; before: string; after: string };

export type Step = {
  id: string;
  tool: string;
  input: string;            // short, redacted summary of the arguments ("→ query")
  args: Record<string, unknown>;
  output?: string;
  status: "running" | "done" | "error";
  edit?: Edit;              // file-writing tools: shown as a diff
  subagent?: { goals: string[]; delegationId?: string; background: boolean };
};

export type Approval = {
  runId: string; requestId: string; generation: number;
  command: string; description: string; choices: string[]; answered?: string;
};

/** One open question from Doss (Hermes clarify), polled from the run's pending_controls. */
export type Question = {
  runId: string; requestId: string; generation: number;
  question: string; choices: string[]; recommended?: string; multi: boolean; answered?: string;
};

export type Turn = {
  user: string;
  text: string;
  steps: Step[];
  approvals: Approval[];
  questions?: Question[];
  usage?: { input_tokens: number; output_tokens: number };
  cost?: number;
  status: "running" | "done" | "failed";
  error?: string;
};

type Msg = {
  role: string; content?: string | null; tool_call_id?: string | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[] | null;
};

const SECRET = /key|token|secret|password|auth/i;
const KEY_FIELDS = ["query", "url", "path", "file_path", "name", "names", "booking_id", "bookingId", "command", "action", "target", "goal"];

/** One-line input hint like the cookbook's "→ query" / "→ filename", without secrets. */
export function summarize(tool: string, args: Record<string, unknown>): string {
  if (tool === "delegate_task") {
    const tasks = (args.tasks as { goal?: string }[] | undefined) ?? [];
    return tasks.map((t) => t.goal ?? "").join(" | ").slice(0, 120);
  }
  if (tool === "clarify") {
    return ((args.questions as { question?: string }[] | undefined) ?? []).map((q) => q.question ?? "").join(" | ").slice(0, 120);
  }
  if (tool === "tool_call") {
    return ((args.calls as { name: string }[] | undefined) ?? []).map((c) => c.name.replace(/^mcp__/, "")).join(", ");
  }
  for (const k of KEY_FIELDS) {
    const v = args[k];
    if (v !== undefined && !SECRET.test(k)) return (Array.isArray(v) ? v.join(", ") : String(v)).slice(0, 120);
  }
  const safe = Object.fromEntries(Object.entries(args).filter(([k]) => !SECRET.test(k)));
  return Object.keys(safe).length ? JSON.stringify(safe).slice(0, 120) : "";
}

/** File-writing tools (sandbox files, Doss's own skills and memory) become a before/after edit. */
function editOf(tool: string, args: Record<string, unknown>): Edit | undefined {
  const path = String(args.path ?? args.file_path ?? args.name ?? args.target ?? tool);
  const oldText = (args.old_string ?? args.old_text) as string | undefined;
  const newText = (args.new_string ?? args.new_text) as string | undefined;
  if (!["write_file", "patch", "skill_manage", "memory"].includes(tool)) return undefined;
  if (oldText !== undefined || newText !== undefined) return { path, before: oldText ?? "", after: newText ?? "" };
  if (typeof args.content === "string") return { path, before: "", after: args.content };
  return undefined;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  try { return JSON.parse(String(raw ?? "{}")); } catch { return {}; }
}

function subagentOf(tool: string, args: Record<string, unknown>, output?: string): Step["subagent"] {
  if (tool !== "delegate_task") return undefined;
  const goals = ((args.tasks as { goal?: string }[] | undefined) ?? []).map((t) => t.goal ?? "");
  const out = parseArgs(output);
  return { goals, delegationId: out.delegation_id as string | undefined, background: out.mode === "background" };
}

export function makeStep(id: string, tool: string, rawArgs: unknown, output?: string, status: Step["status"] = "running"): Step {
  const args = parseArgs(rawArgs);
  return { id, tool, args, input: summarize(tool, args), output, status, edit: editOf(tool, args), subagent: subagentOf(tool, args, output) };
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
    return calls.map((inner, i) => makeStep(`${c.id}-${i}`, inner.name, inner.arguments, out, status));
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
    case "tool.started":
      t.steps.push(makeStep(`live-${t.steps.length}`, String(d.tool_name), d.args));
      break;
    case "tool.completed":
    case "tool.failed": {
      const i = t.steps.findIndex((s) => s.status === "running" && s.tool === d.tool_name);
      if (i >= 0) t.steps[i] = { ...t.steps[i], status: name === "tool.failed" ? "error" : "done" };
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
      t.usage = d.usage as Turn["usage"];
      t.status = "done";
      break;
    }
    case "run.failed":
    case "run.cancelled":
      t.status = "failed";
      t.error = String(d.error ?? name);
      break;
  }
  return t;
}

/** Minimal SSE parser: feed text chunks, get back complete {name, data} events. */
export function sseParser(onEvent: (name: string, data: Record<string, unknown>) => void) {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
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
      if (data.length) onEvent(name, JSON.parse(data.join("\n")));
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
