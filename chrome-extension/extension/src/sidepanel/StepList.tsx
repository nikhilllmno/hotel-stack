import { useState } from "react";
import { Camera, Check, ChevronRight, Globe, Keyboard, LoaderCircle, MousePointerClick, ScanText, Wrench, X } from "lucide-react";
import { toolText, type Step, type StepKind } from "../lib/hermes-events";

const ICONS: Record<StepKind, typeof Globe> = {
  navigate: Globe, tabs: Globe, act: MousePointerClick, type: Keyboard, screenshot: Camera, snapshot: ScanText, wait: LoaderCircle, other: Wrench,
};

function StatusIcon({ status }: { status: Step["status"] }) {
  if (status === "running") return <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Running" />;
  if (status === "error") return <X className="size-3.5 shrink-0 text-destructive" aria-label="Failed" />;
  return <Check className="size-3.5 shrink-0 text-muted-foreground" aria-label="Done" />;
}

/** One step: icon by kind, one-line label, status, and the tool's output on demand. */
export function StepRow({ step }: { step: Step }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[step.kind];
  const output = toolText(step.output).trim();
  const row = (
    <>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{step.label}</span>
      <StatusIcon status={step.status} />
    </>
  );
  const cls = "flex w-full items-center gap-2 rounded-md px-2 py-1 text-start text-xs";
  return (
    <div>
      {output ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`${cls} cursor-pointer hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none`}>{row}</button>
      ) : (
        <div className={cls}>{row}</div>
      )}
      {open && output && (
        <pre className="mx-2 mb-1 max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap break-all">{output.slice(0, 4000)}</pre>
      )}
    </div>
  );
}

/** The turn's steps: a single step shows inline, several collapse into "Working... N steps" (open while running). */
export function StepList({ steps, running }: { steps: Step[]; running: boolean }) {
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  if (!steps.length) return null;
  if (steps.length === 1) return <div className="rounded-lg border border-border"><StepRow step={steps[0]} /></div>;
  const expanded = open ?? running;
  const n = steps.length;
  return (
    <div className="rounded-lg border border-border">
      <button type="button" aria-expanded={expanded} onClick={() => setOpen(!expanded)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-start text-xs font-medium hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
        <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{running ? "Working..." : "Worked"} {n} steps</span>
        {running && <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
      </button>
      {expanded && <div className="border-t border-border p-1">{steps.map((s) => <StepRow key={s.id} step={s} />)}</div>}
    </div>
  );
}
