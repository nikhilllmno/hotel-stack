import { Check, ShieldAlert, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { parseApproval, type Approval } from "../lib/hermes-events";
import type { AnswerState } from "./use-chat";

type Props = {
  approval: Approval;
  state?: AnswerState;
  expired: boolean;  // the run ended without an answer (Hermes fails closed after its approval timeout)
  onAnswer: (choice: "once" | "deny") => void;
};

/** Guard for a risky browser action: what Hermes wants to do, and Approve / Deny. Never says Approved before Hermes accepted. */
export function ApprovalCard({ approval, state, expired, onAnswer }: Props) {
  const s = parseApproval(approval);
  const posting = state?.phase === "posting";
  const done = state?.phase === "done" ? state.choice : approval.answered;
  return (
    <Card size="sm" role="group" aria-label="Approval needed">
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center gap-2 font-medium">
          <ShieldAlert className="size-4 shrink-0" aria-hidden />
          Hermes wants to:
        </div>
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-medium break-words">{s.action}{s.element ? ` ${s.element}` : ""}</p>
          {s.detail && <p className="overflow-x-auto rounded-md bg-muted px-2 py-1 font-mono text-xs whitespace-pre-wrap break-all">{s.detail}</p>}
          {s.reason && <p className="break-words text-muted-foreground">Reason: {s.reason}</p>}
        </div>
        {done ? (
          <p className="flex items-center gap-1.5 text-xs font-medium">
            {done === "deny" ? <X className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
            {done === "deny" ? "Denied" : "Approved"}
          </p>
        ) : expired ? (
          <p className="text-xs text-muted-foreground">Not answered in time. Hermes did not run this action.</p>
        ) : (
          <>
            <div className="flex gap-2">
              <Button size="sm" disabled={posting} onClick={() => onAnswer("once")}>{posting && state?.choice === "once" ? "Approving..." : "Approve"}</Button>
              <Button size="sm" variant="outline" disabled={posting} onClick={() => onAnswer("deny")}>{posting && state?.choice === "deny" ? "Denying..." : "Deny"}</Button>
            </div>
            {state?.phase === "error" && <p role="alert" className="text-xs text-destructive">{state.error}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
