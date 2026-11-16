"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { ChangeFiles, ChecksList, GuestTexts, ReviewBox, STATUS_TONE, statusLabel } from "@/components/change-view";
import type { ChangeDetail } from "@/lib/api";

/** Doss proposed a change: show its diff, checks and review right in the chat; approval is on /changes. */
export function ProposalCard({ id }: { id: number }) {
  const [change, setChange] = useState<ChangeDetail | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      const r = await fetch(`/api/doss/changes/${id}`);
      if (!r.ok || stop) return;
      const c: ChangeDetail = await r.json();
      setChange(c);
      if (c.status === "checking" || c.status === "sending") setTimeout(load, 5000);
    };
    load();
    return () => { stop = true; };
  }, [id]);

  if (!change) return <div className="my-2 rounded-lg border border-border p-3 text-xs text-muted-foreground">Loading change #{id}…</div>;
  return (
    <div className="my-2 space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">Change #{change.id}: {change.title}</div>
          <div className="text-xs text-muted-foreground">{change.reason}</div>
        </div>
        <Badge tone={STATUS_TONE[change.status]}>{statusLabel(change)}</Badge>
      </div>
      {change.kind === "guest_texts" ? <GuestTexts change={change} /> : (
        <>
          <ReviewBox review={change.checks.review} />
          <ChecksList change={change} />
          <ChangeFiles change={change} open={false} />
        </>
      )}
      <Link href={`/changes?id=${change.id}`} className="inline-block text-sm font-medium underline underline-offset-4">
        {change.status === "ready" ? "Review and approve" : "Open in Pending changes"}
      </Link>
    </div>
  );
}
