import { Button } from "../components/ui/button";

export const EXAMPLES = ["Summarise this page", "Find tomorrow's arrivals in Beds24", "Check our rates on Booking.com"];

/** New chat: what Hermes can do here and three prompts to start from. */
export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-4 overflow-y-auto px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-base font-semibold">Chat with Hermes</h1>
        <p className="text-sm text-muted-foreground">Hermes works in your open Chrome tabs. It reads and navigates on its own and asks you before anything risky, like sending or paying.</p>
      </div>
      <div className="flex flex-col items-stretch gap-2">
        {EXAMPLES.map((p) => <Button key={p} variant="outline" className="justify-start" onClick={() => onPick(p)}>{p}</Button>)}
      </div>
    </div>
  );
}
