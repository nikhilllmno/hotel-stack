"use client";

import { useContext, useState, type FC, type PropsWithChildren } from "react";
import { useAssistantDataUI, type ToolCallMessagePartComponent } from "@assistant-ui/react";
import { DiffView } from "@/components/diff-view";
import type { ThreadGroupPart } from "@/components/assistant-ui/elements/thread.aui";
import { ToolGroupContent, ToolGroupRoot, ToolGroupTrigger } from "@/components/assistant-ui/elements/tool-group.aui";
import { Button } from "@/components/ui/button";
import type { Approval, Question, Step } from "@/lib/doss-events";
import { APPROVAL_DATA, CHANGE_DATA, QUESTION_DATA, SUMMARY_DATA, type RunSummary } from "@/lib/doss-messages";
import { DossActions } from "./actions-context";
import { ProposalCard } from "./proposal-card";
import { QuestionCard } from "./question-card";

export { DossActions } from "./actions-context";

const short = (tool: string) => tool.replace(/^mcp__/, "").replace(/__/g, " / ");

function StatusDot({ status }: { status: Step["status"] }) {
  const tone = status === "running" ? "animate-pulse bg-blue-500" : status === "error" ? "bg-red-500" : "bg-green-500";
  return <span className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${tone}`} />;
}

/** One Doss step: the live line while it runs, then input, output, diff and subagent details on demand. */
function StepCard({ step }: { step: Step }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(step.output || step.edit || step.subagent);
  return (
    <div className="my-1 rounded-lg border border-border bg-card text-xs">
      <button type="button" onClick={() => setOpen(!open)} disabled={!hasDetail}
        className="flex w-full items-start gap-2 px-3 py-2 text-start enabled:cursor-pointer">
        <StatusDot status={step.status} />
        <span className="min-w-0 flex-1">
          <span className="text-muted-foreground">{step.subagent ? "Delegating to subagent" : step.status === "running" ? "Using" : "Used"} </span>
          {!step.subagent && <span className="font-mono font-semibold">{short(step.tool)}</span>}
          {step.input && <span className="font-mono text-muted-foreground"> → {step.input}</span>}
        </span>
        {hasDetail && <span className="text-muted-foreground">{open ? "hide" : "details"}</span>}
      </button>
      {step.edit && !open && <div className="px-3 pb-2"><DiffView {...step.edit} open={false} /></div>}
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {step.subagent && (
            <div className="rounded-md border-l-2 border-violet-400 bg-violet-50 px-2 py-1 text-violet-900">
              {step.subagent.goals.map((g, i) => <div key={i}>Task: {g}</div>)}
              {step.subagent.background && <div className="mt-1 text-violet-700">Runs in the background; its answer arrives as a new message.</div>}
            </div>
          )}
          {step.edit && <DiffView {...step.edit} />}
          {step.output && (
            <pre className="max-h-72 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{step.output.slice(0, 6000)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

/** assistant-ui ToolFallback: every Doss tool call renders as a StepCard. */
export const DossToolCard: ToolCallMessagePartComponent = ({ args }) => <StepCard step={(args as { step: Step }).step} />;

/** Tool group: open while Doss is working (the live feed), collapsed to "N steps" once the run is done. */
export const DossToolGroup: FC<PropsWithChildren<{ group: ThreadGroupPart }>> = ({ group, children }) => {
  const running = group.status.type === "running";
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  return (
    <ToolGroupRoot variant="ghost" open={open ?? running} onOpenChange={setOpen}>
      <ToolGroupTrigger count={group.indices.length} active={running} />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  );
};

/** "Always allow" only for our own low-risk hotel tools (mark done, run tests); Beds24 writes stay one-at-a-time. */
function canAlwaysAllow(a: Approval): boolean {
  return a.choices.includes("always") && /server 'hotel'/.test(`${a.command} ${a.description}`);
}

function ApprovalCard({ approval: a }: { approval: Approval }) {
  const { answer } = useContext(DossActions);
  const [busy, setBusy] = useState(false);
  const respond = async (choice: string) => { setBusy(true); await answer(a, choice); setBusy(false); };
  return (
    <div className="my-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <div className="font-medium">Doss needs your approval</div>
      <div className="mt-1 text-xs whitespace-pre-wrap">{a.description || a.command}</div>
      {a.answered ? (
        <div className="mt-2 text-xs font-medium">{a.answered === "deny" ? "Denied" : `Approved (${a.answered})`}</div>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => respond("once")}>Approve once</Button>
          {canAlwaysAllow(a) && <Button size="sm" variant="outline" disabled={busy} onClick={() => respond("always")}>Always allow</Button>}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => respond("deny")}>Deny</Button>
        </div>
      )}
    </div>
  );
}

function RunFooter({ summary: s }: { summary: RunSummary }) {
  return (
    <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
      {s.model && <span>{s.model}</span>}
      {s.usage && <span>{s.usage.input_tokens.toLocaleString()} in / {s.usage.output_tokens.toLocaleString()} out tokens</span>}
      {s.cost !== undefined && <span>${s.cost.toFixed(3)} (Hermes estimate)</span>}
    </div>
  );
}

/** Registers the renderers for our data parts (approvals, run footer). Mount inside the runtime provider. */
export function DossDataRenderers() {
  useAssistantDataUI({ name: APPROVAL_DATA, render: ({ data }) => <ApprovalCard approval={data as Approval} /> });
  useAssistantDataUI({ name: SUMMARY_DATA, render: ({ data }) => <RunFooter summary={data as RunSummary} /> });
  useAssistantDataUI({ name: QUESTION_DATA, render: ({ data }) => <QuestionCard q={data as Question} /> });
  useAssistantDataUI({ name: CHANGE_DATA, render: ({ data }) => <ProposalCard id={(data as { id: number }).id} /> });
  return null;
}
