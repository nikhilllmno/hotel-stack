"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ChangeStatus } from "@/lib/api";
import { decide } from "./actions";

const WORKING = { approve: "Working…", reject: "Rejecting…", undo: "Undoing and publishing…" };

/** Approve / Reject / Undo with a confirm step (no browser dialogs), and auto-refresh while checks run. */
export function Decision({ id, status, texts = false, sendAt = null }: { id: number; status: ChangeStatus; texts?: boolean; sendAt?: string | null }) {
  const router = useRouter();
  const [asking, setAsking] = useState<"approve" | "reject" | "undo" | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!["checking", "sending", "scheduled"].includes(status)) return;
    const timer = setInterval(() => router.refresh(), status === "scheduled" ? 30000 : 5000);
    return () => clearInterval(timer);
  }, [status, router]);

  const run = (action: "approve" | "reject" | "undo") => start(async () => {
    const out = await decide(id, action);
    setError(out.error ?? "");
    setAsking(null);
  });

  if (pending && asking) return <span className="text-sm text-muted-foreground">{WORKING[asking]}</span>;
  if (asking) {
    const text = {
      approve: texts ? (sendAt ? "Approve these texts? They go out at the scheduled time." : "Send these texts to the guests now?")
        : "This goes live now (Danny is republished if his files change).",
      reject: status === "scheduled" ? "Cancel these scheduled texts?" : "Reject this change?",
      undo: "Restore the files as they were before this change?" }[asking];
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{text}</span>
        <Button size="sm" variant={asking === "approve" ? "default" : "destructive"} onClick={() => run(asking)}>
          Yes, {asking === "approve" && texts && !sendAt ? "send" : asking === "reject" && status === "scheduled" ? "cancel" : asking}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "ready" && <Button size="sm" onClick={() => setAsking("approve")}>{texts ? (sendAt ? "Approve schedule" : "Approve and send") : "Approve"}</Button>}
      {["checking", "ready", "failed", "scheduled"].includes(status) && (
        <Button size="sm" variant="outline" onClick={() => setAsking("reject")}>{status === "scheduled" ? "Cancel" : "Reject"}</Button>
      )}
      {status === "applied" && !texts && <Button size="sm" variant="outline" onClick={() => setAsking("undo")}>Undo</Button>}
      {error && <span className="text-sm text-red-700">{error}</span>}
    </div>
  );
}
