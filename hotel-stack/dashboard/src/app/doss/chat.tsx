"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AssistantRuntimeProvider, useExternalStoreRuntime,
  type AppendMessage, type AttachmentAdapter, type ThreadMessageLike,
} from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { ThreadList } from "@/components/assistant-ui/elements/thread-list.aui";
import { TooltipProvider } from "@/components/ui/tooltip";
import { applyEvent, sseParser, toQuestion, turnsFromHistory, type Approval, type Question, type Turn } from "@/lib/doss-events";
import { toThreadMessages } from "@/lib/doss-messages";
import { DossActions, DossDataRenderers, DossToolCard, DossToolGroup } from "./tool-card";

type Session = { id: string; title: string | null; preview: string | null; estimated_cost_usd?: number; model?: string };
type History = { messages: Parameters<typeof turnsFromHistory>[0]; session: Session };

const SUGGESTIONS = [
  { title: "Arrivals this week", prompt: "Who is arriving this week? Room, dates and guests." },
  { title: "Unpaid deposits", prompt: "Which booking requests still have an unpaid deposit?" },
  { title: "How did calls go?", prompt: "Summarize Danny's calls from the last 7 days." },
  { title: "Analyze a file", prompt: "I'm attaching a file. Summarize the key numbers." },
];

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

/** Files go to Doss's sandbox (/uploads); the message carries their paths. */
const uploads: AttachmentAdapter = {
  accept: "*/*",
  async add({ file }) {
    return {
      id: crypto.randomUUID(), type: file.type.startsWith("image/") ? "image" : "document", name: file.name,
      contentType: file.type, file, status: { type: "requires-action", reason: "composer-send" },
    };
  },
  async send(a) {
    const form = new FormData();
    form.append("file", a.file);
    const up = await json<{ path: string }>("/api/doss/upload", { method: "POST", body: form });
    return { ...a, status: { type: "complete" }, content: [{ type: "text", text: `${up.path} (${a.name})` }] };
  },
  async remove() {},
};

function messageText(m: AppendMessage): string {
  const text = m.content.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n").trim();
  const files = (m.attachments ?? []).flatMap((a) => a.content.flatMap((p) => (p.type === "text" ? [`- ${p.text}`] : [])));
  return files.length ? `${text}\n\nAttached files (in your sandbox at /uploads):\n${files.join("\n")}` : text;
}

/** Keep live-only details (usage, cost, approvals) when turns are rebuilt from the stored transcript. */
const merge = (fresh: Turn[], old: Turn[]) =>
  fresh.map((t, i) => (old[i] ? { ...t, usage: old[i].usage, cost: old[i].cost, approvals: old[i].approvals, questions: old[i].questions } : t));

export function DossChat() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [model, setModel] = useState<string>();
  const [running, setRunning] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});  // approval request id -> choice
  const turnsRef = useRef<Turn[]>([]);
  const costRef = useRef(0);
  const runIdRef = useRef("");
  useEffect(() => { turnsRef.current = turns; }, [turns]);

  const loadSessions = useCallback(() => json<{ data: Session[] }>("/api/doss/sessions").then((d) => setSessions(d.data ?? [])), []);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  const refresh = useCallback(async (id: string, keep: Turn[] = []) => {
    const d = await json<History>(`/api/doss/sessions/${id}/messages`);
    setTurns(merge(turnsFromHistory(d.messages), keep));
    setModel(d.session.model);
    costRef.current = d.session.estimated_cost_usd ?? 0;
    return d;
  }, []);

  const pollForSubagent = useCallback((id: string, seen: number) => {
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      const d = await refresh(id, turnsRef.current);
      if (d.messages.length > seen || tries >= 20) clearInterval(timer);
    }, 15000);
  }, [refresh]);

  const onNew = useCallback(async (m: AppendMessage) => {
    const message = messageText(m);
    let id = sessionId;
    if (!id) {
      id = (await json<{ session: Session }>("/api/doss/sessions", { method: "POST", body: JSON.stringify({ title: message.slice(0, 60) }) })).session.id;
      setSessionId(id);
      loadSessions();
    }
    setRunning(true);
    let live: Turn = { user: message, text: "", steps: [], approvals: [], status: "running" };
    setTurns((ts) => [...ts, live]);
    try {
      const res = await fetch(`/api/doss/sessions/${id}/stream`, { method: "POST", body: JSON.stringify({ message }) });
      if (!res.ok || !res.body) throw new Error(`Doss is unavailable (${res.status}): ${await res.text()}`);
      const show = () => setTurns((ts) => [...ts.slice(0, -1), live]);
      let polling = false;
      /** Doss is asking (clarify): its questions are pending prompts on the run, not stream events, so poll them. */
      const pollQuestions = async () => {
        if (polling) return;
        polling = true;
        while (live.status === "running" && live.steps.some((s) => s.tool === "clarify" && s.status === "running")) {
          const runId = runIdRef.current;
          const st = runId ? await fetch(`/api/doss/runs/${runId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
          const known = new Set((live.questions ?? []).map((q) => q.requestId));
          const fresh = ((st?.pending_controls ?? []) as Record<string, unknown>[])
            .filter((c) => c.kind === "clarify" && !known.has(String(c.prompt_id))).map((c) => toQuestion(c, runId));
          if (fresh.length) {
            live = { ...live, questions: [...(live.questions ?? []), ...fresh] };
            show();
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
        polling = false;
      };
      const feed = sseParser((name, data) => {
        if (data.run_id) runIdRef.current = String(data.run_id);
        live = applyEvent(live, name, data);
        show();
        if (name === "tool.started" && data.tool_name === "clarify") pollQuestions();
      });
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (let r = await reader.read(); !r.done; r = await reader.read()) feed(r.value);
      const before = costRef.current;
      const d = await refresh(id, turnsRef.current);
      const cost = (d.session.estimated_cost_usd ?? 0) - before;
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, usage: live.usage, cost, approvals: live.approvals, questions: live.questions } : t)));
      loadSessions();
      if (live.steps.some((s) => s.subagent?.background)) pollForSubagent(id, d.messages.length);
    } catch (e) {
      setTurns((ts) => [...ts.slice(0, -1), { ...live, status: "failed", error: String(e) }]);
    } finally {
      setRunning(false);
      runIdRef.current = "";
    }
  }, [sessionId, refresh, loadSessions, pollForSubagent]);

  const onCancel = useCallback(async () => {
    if (runIdRef.current) await json("/api/doss/stop", { method: "POST", body: JSON.stringify({ run_id: runIdRef.current }) }).catch(() => {});
  }, []);

  const answer = useCallback(async (a: Approval, choice: string) => {
    await json("/api/doss/approval", {
      method: "POST",
      body: JSON.stringify({ run_id: a.runId, request_id: a.requestId, execution_generation: a.generation, choice }),
    });
    setAnswers((m) => ({ ...m, [a.requestId]: choice }));
  }, []);

  const answerQuestion = useCallback(async (q: Question, answer: string) => {
    await json("/api/doss/clarify", {
      method: "POST",
      body: JSON.stringify({ run_id: q.runId, request_id: q.requestId, execution_generation: q.generation, answer }),
    });
    setAnswers((m) => ({ ...m, [q.requestId]: answer }));
  }, []);

  const threadList = useMemo(() => ({
    threadId: sessionId || undefined,
    threads: sessions.map((s) => ({ status: "regular" as const, id: s.id, title: s.title || s.preview || "Untitled" })),
    onSwitchToThread: async (id: string) => { setSessionId(id); setTurns([]); await refresh(id); },
    onSwitchToNewThread: () => { setSessionId(""); setTurns([]); setModel(undefined); costRef.current = 0; },
    onDelete: async (id: string) => {
      await json(`/api/doss/sessions/${id}`, { method: "DELETE" });
      if (id === sessionId) { setSessionId(""); setTurns([]); }
      await loadSessions();
    },
  }), [sessions, sessionId, refresh, loadSessions]);

  const messages = useMemo(() => toThreadMessages(
    turns.map((t) => ({
      ...t,
      approvals: t.approvals.map((a) => ({ ...a, answered: answers[a.requestId] ?? a.answered })),
      questions: t.questions?.map((q) => ({ ...q, answered: answers[q.requestId] ?? q.answered })),
    })),
    model,
  ), [turns, model, answers]);
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages, convertMessage: (m) => m, isRunning: running, onNew, onCancel,
    suggestions: SUGGESTIONS, adapters: { attachments: uploads, threadList },
  });

  /** /doss?ask=... (e.g. an app's "Ask Doss" button) pre-fills the composer; the owner presses send. */
  useEffect(() => {
    const ask = new URLSearchParams(window.location.search).get("ask");
    if (ask) runtime.thread.composer.setText(ask);
  }, [runtime]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <DossDataRenderers />
      <DossActions.Provider value={{ answer, answerQuestion }}>
        <TooltipProvider>
          <div className="flex h-[calc(100vh-3rem)] gap-4">
            <aside className="w-64 shrink-0 overflow-y-auto rounded-xl border border-border bg-background p-2">
              <ThreadList />
            </aside>
            <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-background">
              <Thread components={{ ToolFallback: DossToolCard, ToolGroup: DossToolGroup }} />
            </div>
          </div>
        </TooltipProvider>
      </DossActions.Provider>
    </AssistantRuntimeProvider>
  );
}
