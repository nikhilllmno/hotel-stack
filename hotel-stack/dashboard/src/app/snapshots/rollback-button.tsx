"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { rollback } from "./actions";

/** Two-step button: the first click asks, the second rolls back (browser dialogs are avoided on purpose). */
export function RollbackButton({ versionId }: { versionId: number }) {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  if (pending) return <span className="text-sm text-muted-foreground">Rolling back and publishing…</span>;
  if (!asking) return <Button variant="outline" size="sm" onClick={() => setAsking(true)}>Roll back to this version</Button>;
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Danny will go live with version {versionId} again. Sure?</span>
      <Button variant="destructive" size="sm" onClick={() => start(() => rollback(versionId))}>Yes, roll back</Button>
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>Cancel</Button>
    </span>
  );
}
