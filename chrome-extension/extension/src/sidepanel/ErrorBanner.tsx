import { useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { CORS_ORIGINS_LINE, type HermesErrorKind } from "../lib/hermes-client";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button variant="outline" size="xs" onClick={() => { void navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>
      {done ? <Check /> : <Copy />}{done ? "Copied" : label}
    </Button>
  );
}

/** An error with what to do about it; 403 shows the exact cors_origins line. */
export function ErrorBanner({ message, kind, onRetry }: { message: string; kind?: HermesErrorKind; onRetry?: () => void }) {
  return (
    <Card size="sm" role="alert">
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-start gap-2 text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0 break-words">{message}</p>
        </div>
        {kind === "forbidden" && (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-2 py-1 font-mono text-[11px] whitespace-nowrap">{CORS_ORIGINS_LINE}</code>
            <CopyButton text={CORS_ORIGINS_LINE} />
          </div>
        )}
        {onRetry && <div><Button variant="outline" size="sm" onClick={onRetry}>Retry</Button></div>}
      </CardContent>
    </Card>
  );
}
