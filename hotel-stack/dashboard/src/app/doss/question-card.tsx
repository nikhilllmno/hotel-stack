"use client";

import { useContext, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Question } from "@/lib/doss-events";
import { cn } from "@/lib/utils";
import { DossActions } from "./actions-context";

/** One of Doss's questions: choice buttons (recommended first), "Other" free text, multi-select, or a plain field. */
export function QuestionCard({ q }: { q: Question }) {
  const { answerQuestion } = useContext(DossActions);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState(q.choices.length === 0);
  const [busy, setBusy] = useState(false);

  const send = async (answer: string) => {
    if (!answer.trim()) return;
    setBusy(true);
    await answerQuestion(q, answer.trim());
    setBusy(false);
  };

  if (q.answered !== undefined) {
    return (
      <div className="my-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
        <div className="text-muted-foreground">{q.question}</div>
        <div className="mt-1 font-medium">{q.answered === "skip" ? "Skipped" : q.answered}</div>
      </div>
    );
  }
  return (
    <div className="my-2 space-y-3 rounded-lg border border-sky-300 bg-sky-50/60 p-3 text-sm">
      <div className="font-medium whitespace-pre-wrap">{q.question}</div>
      {q.choices.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {q.choices.map((c) => {
            const on = picked.includes(c);
            return (
              <Button key={c} size="sm" disabled={busy} variant={q.multi ? (on ? "default" : "outline") : c === q.recommended ? "default" : "outline"}
                onClick={() => (q.multi ? setPicked(on ? picked.filter((x) => x !== c) : [...picked, c]) : send(c))}>
                {c}{c === q.recommended && <span className="ml-1 text-[10px] opacity-70">recommended</span>}
              </Button>
            );
          })}
          {!other && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOther(true)}>Other…</Button>}
        </div>
      )}
      {(other || q.multi) && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(q.multi ? [...picked, text].filter(Boolean).join(", ") : text); }}>
          {other && <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
            placeholder={q.choices.length ? "Type your answer" : "Your answer"} className="bg-background" />}
          <Button type="submit" size="sm" disabled={busy || (q.multi ? picked.length === 0 && !text.trim() : !text.trim())}>
            {q.multi ? "Submit" : "Send"}
          </Button>
        </form>
      )}
      <button type="button" disabled={busy} onClick={() => send("skip")}
        className={cn("text-xs text-muted-foreground underline-offset-4 hover:underline", busy && "opacity-50")}>
        Skip this question
      </button>
    </div>
  );
}
