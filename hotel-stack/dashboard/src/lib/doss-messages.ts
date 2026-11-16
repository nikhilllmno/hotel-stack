import type { ThreadMessageLike } from "@assistant-ui/react";
import type { Approval, Question, Step, Turn } from "./doss-events";

/** Data-part names (not Doss tools): rendered by renderers registered with useAssistantDataUI. */
export const APPROVAL_DATA = "hermes_approval";
export const SUMMARY_DATA = "hermes_run_summary";
export const CHANGE_DATA = "hermes_change";
export const QUESTION_DATA = "hermes_question";

const PROPOSAL_TOOLS = /^mcp__hotel__(draft_change|propose_change|propose_rollback|propose_guest_texts)$/;

/** The change id a finished proposal tool returned (its output may be wrapped as untrusted tool text). */
export function proposedChangeId(step: Step): number | null {
  if (!PROPOSAL_TOOLS.test(step.tool) || step.status !== "done" || !step.output) return null;
  const id = step.output.match(/\\?"id\\?":\s*(\d+)/)?.[1];  // plain or JSON-escaped (\"id\": 2) inside the MCP result
  return id ? Number(id) : null;
}

export type RunSummary = { model?: string; usage?: Turn["usage"]; cost?: number };

type Json = ThreadMessageLike extends { content: infer C } ? C : never;
type Part = Exclude<Json, string>[number];

function stepPart(step: Step): Part {
  const finished = step.status !== "running";
  return {
    type: "tool-call", toolCallId: step.id, toolName: step.tool,
    args: { step } as never, argsText: step.input,
    result: finished ? (step.output ?? "") : undefined, isError: step.status === "error",
  };
}

function approvalPart(a: Approval): Part {
  return { type: `data-${APPROVAL_DATA}`, id: `approval-${a.requestId}`, data: a };
}

/** Our turns (Hermes runs) as assistant-ui messages: user text, then tool steps, approvals, reply text, summary. */
export function toThreadMessages(turns: Turn[], model?: string): ThreadMessageLike[] {
  return turns.flatMap((t, i): ThreadMessageLike[] => {
    const questions = (t.questions ?? []).map((q: Question): Part => ({ type: `data-${QUESTION_DATA}`, id: `question-${q.requestId}`, data: q }));
    const parts: Part[] = [...t.steps.map(stepPart), ...t.approvals.map(approvalPart), ...questions];
    if (t.text) parts.push({ type: "text", text: t.text });
    for (const id of new Set(t.steps.map(proposedChangeId).filter((x): x is number => x !== null))) {
      parts.push({ type: `data-${CHANGE_DATA}`, id: `change-${id}`, data: { id } });
    }
    if (t.status === "failed") parts.push({ type: "text", text: `Run failed: ${t.error ?? "unknown error"}` });
    if (t.status !== "running" && (t.usage || t.cost !== undefined)) {
      const summary: RunSummary = { model, usage: t.usage, cost: t.cost };
      parts.push({ type: `data-${SUMMARY_DATA}`, id: `summary-${i}`, data: summary });
    }
    return [
      { id: `u${i}`, role: "user", content: [{ type: "text", text: t.user }] },
      {
        id: `a${i}`, role: "assistant", content: parts,
        status: t.status === "running" ? { type: "running" } : t.status === "failed"
          ? { type: "incomplete", reason: "error" } : { type: "complete", reason: "stop" },
      },
    ];
  });
}
