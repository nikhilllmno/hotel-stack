import { useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import type { Question } from "../lib/hermes-events";
import type { AnswerState } from "./use-chat";

type Props = { q: Question; state?: AnswerState; expired: boolean; onAnswer: (answer: string) => void };

/** One of Hermes's questions: choice buttons (recommended marked), "Other" free text, multi-select, or a plain field. */
export function QuestionCard({ q, state, expired, onAnswer }: Props) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState(q.choices.length === 0);
  const busy = state?.phase === "posting";
  const answered = state?.phase === "done" ? state.choice : undefined;
  const send = (a: string) => { if (a.trim()) onAnswer(a.trim()); };

  if (answered !== undefined || expired) {
    return (
      <Card size="sm">
        <CardContent>
          <p className="text-muted-foreground">{q.question}</p>
          <p className="mt-1 font-medium">{answered === undefined ? "Not answered" : answered === "skip" ? "Skipped" : answered}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card size="sm" role="group" aria-label="Question from Hermes">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start gap-2 font-medium">
          <MessageCircleQuestion className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0 whitespace-pre-wrap break-words">{q.question}</p>
        </div>
        {q.choices.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {q.choices.map((c) => {
              const on = picked.includes(c);
              return (
                <Button key={c} size="sm" disabled={busy} variant={q.multi ? (on ? "default" : "outline") : "outline"} aria-pressed={q.multi ? on : undefined}
                  onClick={() => (q.multi ? setPicked(on ? picked.filter((x) => x !== c) : [...picked, c]) : send(c))}>
                  {c}{c === q.recommended && <span className="text-[10px] text-muted-foreground">recommended</span>}
                </Button>
              );
            })}
            {!other && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOther(true)}>Other...</Button>}
          </div>
        )}
        {(other || q.multi) && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(q.multi ? [...picked, text].filter(Boolean).join(", ") : text); }}>
            {other && <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} disabled={busy} aria-label="Your answer" placeholder={q.choices.length ? "Type your answer" : "Your answer"} />}
            <Button type="submit" size="sm" disabled={busy || (q.multi ? picked.length === 0 && !text.trim() : !text.trim())}>{q.multi ? "Submit" : "Send"}</Button>
          </form>
        )}
        <div>
          <Button variant="link" size="xs" disabled={busy} onClick={() => send("skip")}>Skip this question</Button>
        </div>
        {state?.phase === "error" && <p role="alert" className="text-xs text-destructive">{state.error}</p>}
      </CardContent>
    </Card>
  );
}
