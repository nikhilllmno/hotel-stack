import { ErrorBanner } from "./ErrorBanner";
import type { HermesError, Session } from "../lib/hermes-client";

/** "3 min ago", "yesterday", from Hermes' epoch seconds. */
export function relativeTime(epochSeconds: number | undefined, now = Date.now()): string {
  if (!epochSeconds) return "";
  const s = Math.round(epochSeconds - now / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of units) if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit);
  return "just now";
}

type Props = {
  sessions: Session[]; loading: boolean; error: HermesError | null; currentId: string;
  onOpen: (id: string) => void; onRetry: () => void;
};

/** Hermes sessions started through the API, newest first. */
export function ChatList({ sessions, loading, error, currentId, onOpen, onRetry }: Props) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <h1 className="mb-2 text-sm font-semibold">Chats</h1>
      {error ? (
        <ErrorBanner message={error.message} kind={error.kind} onRetry={onRetry} />
      ) : loading && !sessions.length ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading chats">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />)}
        </div>
      ) : !sessions.length ? (
        <p className="text-sm text-muted-foreground">No chats yet. Start one with the plus button.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {sessions.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onOpen(s.id)} aria-current={s.id === currentId ? "true" : undefined}
                className={`flex w-full min-w-0 cursor-pointer flex-col rounded-lg px-3 py-2 text-start hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ${s.id === currentId ? "bg-muted" : ""}`}>
                <span className="truncate text-sm font-medium">{s.title || s.preview || "Untitled"}</span>
                <span className="truncate text-xs text-muted-foreground">{relativeTime(s.last_active ?? s.started_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
