import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { DiffView } from "@/components/diff-view";
import { Badge } from "@/components/ui";
import type { ChangeDetail, ChangeStatus, Check, Review } from "@/lib/api";
import { dateTime } from "@/lib/format";

export const STATUS_TONE: Record<ChangeStatus, "neutral" | "green" | "red" | "amber" | "blue"> = {
  checking: "blue", ready: "amber", failed: "red", applied: "green", rejected: "neutral", undone: "neutral",
  scheduled: "blue", sending: "blue",
};
export const STATUS_LABEL: Record<ChangeStatus, string> = {
  checking: "checking", ready: "waiting for approval", failed: "checks failed", applied: "live", rejected: "rejected", undone: "undone",
  scheduled: "scheduled", sending: "sending",
};

/** Texts read "sent" (not "live") once applied. */
export function statusLabel(change: { kind: string; status: ChangeStatus }): string {
  if (change.kind !== "guest_texts") return STATUS_LABEL[change.status];
  return { applied: "sent", rejected: "rejected" }[change.status as string] ?? STATUS_LABEL[change.status];
}
const RISK_TONE = { Low: "green", Medium: "amber", High: "red" } as const;

export function ReviewBox({ review }: { review?: Review | null }) {
  if (!review) return null;
  if ("error" in review) return <p className="text-sm text-muted-foreground">Review unavailable: {review.error}</p>;
  return (
    <div className="space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
      <div className="flex items-center gap-2"><Badge tone={RISK_TONE[review.risk]}>{review.risk} risk</Badge></div>
      <p>{review.summary}</p>
      <p><span className="font-medium">Guests:</span> {review.guest_impact}</p>
      <p><span className="font-medium">Try after approving:</span> {review.what_to_test}</p>
    </div>
  );
}

function CheckRow({ name, check }: { name: string; check: Check }) {
  const Icon = check.ok ? CircleCheck : CircleAlert;
  return (
    <details className="group text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <Icon className={check.ok ? "size-4 text-emerald-600" : "size-4 text-red-600"} />
        <span className="font-medium capitalize">{name}</span>
        <span className="truncate text-muted-foreground">{check.detail.split("\n").at(-1)}</span>
      </summary>
      <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap">
        {[check.detail, ...(check.failed ?? [])].join("\n")}
      </pre>
    </details>
  );
}

export function ChecksList({ change }: { change: ChangeDetail }) {
  const checks = Object.entries(change.checks).filter(([name]) => name !== "review") as [string, Check][];
  if (change.status === "checking") {
    return <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Running checks ({change.areas.join(", ")})…</p>;
  }
  return <div className="space-y-1.5">{checks.map(([name, c]) => <CheckRow key={name} name={name} check={c} />)}</div>;
}

export function ChangeFiles({ change, open = true }: { change: ChangeDetail; open?: boolean }) {
  return (
    <div className="space-y-2">
      {change.files.map((f) => (
        <DiffView key={f.path} path={f.after === null ? `${f.path} (deleted)` : f.before === null ? `${f.path} (new)` : f.path}
          before={f.before ?? ""} after={f.after ?? ""} open={open} />
      ))}
    </div>
  );
}

/** Guest texts: every recipient and the exact message; after sending, sent or failed (with the reason) per guest. */
export function GuestTexts({ change }: { change: ChangeDetail }) {
  const items = change.proposal.items ?? [];
  const results = new Map((change.sent ?? []).map((r) => [r.to, r]));
  const sentOk = (change.sent ?? []).filter((r) => r.ok).length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {change.send_at ? `Sends ${dateTime(change.send_at)} (hotel time)` : "Sends as soon as you approve"}
        {change.sent && ` · ${sentOk} sent, ${change.sent.length - sentOk} failed`}
      </p>
      <div className="divide-y divide-border rounded-lg ring-1 ring-border">
        {items.map((it) => {
          const r = results.get(it.to);
          return (
            <div key={it.to} className="space-y-1 px-3 py-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><span className="font-medium">{it.name || "Guest"}</span> <span className="text-muted-foreground">{it.to}</span></span>
                {r && <Badge tone={r.ok ? "green" : "red"}>{r.ok ? "sent" : "failed"}</Badge>}
              </div>
              <p className="rounded-lg bg-muted px-3 py-2 whitespace-pre-wrap">{it.body}</p>
              {r && !r.ok && <p className="text-xs text-red-700">{r.error}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
