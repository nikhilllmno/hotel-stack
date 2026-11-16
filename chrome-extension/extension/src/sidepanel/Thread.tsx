import { useLayoutEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";
import { stripContext } from "../lib/context";
import type { Approval, Question, Turn } from "../lib/hermes-events";
import { ApprovalCard } from "./ApprovalCard";
import { ErrorBanner } from "./ErrorBanner";
import { Markdown } from "./Markdown";
import { QuestionCard } from "./QuestionCard";
import { StepList } from "./StepList";
import type { AnswerState } from "./use-chat";

type Props = {
  turns: Turn[];
  answers: Record<string, AnswerState>;
  onApprove: (a: Approval, choice: "once" | "deny") => void;
  onAnswerQuestion: (q: Question, answer: string) => void;
  onRetry: () => void;
};

function TurnView({ turn, last, answers, onApprove, onAnswerQuestion, onRetry }: Omit<Props, "turns"> & { turn: Turn; last: boolean }) {
  const running = turn.status === "running";
  const waiting = running && !turn.text && !turn.steps.length && !turn.approvals.length;
  return (
    <div className="flex flex-col gap-2">
      <div className="ml-auto max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm break-words whitespace-pre-wrap">{stripContext(turn.user)}</div>
      <div className="flex min-w-0 flex-col gap-2">
        {waiting && <p className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" aria-hidden />Thinking...</p>}
        <StepList steps={turn.steps} running={running} />
        {turn.approvals.map((a) => (
          <ApprovalCard key={a.requestId} approval={a} state={answers[a.requestId]} expired={!running} onAnswer={(c) => onApprove(a, c)} />
        ))}
        {(turn.questions ?? []).map((q) => (
          <QuestionCard key={q.requestId} q={q} state={answers[q.requestId]} expired={!running} onAnswer={(a) => onAnswerQuestion(q, a)} />
        ))}
        {turn.text && <Markdown text={turn.text} />}
        {turn.status === "cancelled" && <p className="text-xs text-muted-foreground">Stopped.</p>}
        {turn.status === "failed" && <ErrorBanner message={turn.error ?? "The run failed."} kind={turn.errorKind} onRetry={last ? onRetry : undefined} />}
      </div>
    </div>
  );
}

/** The conversation. Sticks to the bottom while streaming, unless the owner scrolled up. */
export function Thread({ turns, ...rest }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const count = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (turns.length !== count.current) { count.current = turns.length; stick.current = true; }  // a new turn: follow it
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [turns]);
  return (
    <div ref={ref} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-live="polite">
      <div className="flex flex-col gap-4">
        {turns.map((t, i) => <TurnView key={i} turn={t} last={i === turns.length - 1} {...rest} />)}
      </div>
    </div>
  );
}
