import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Settings } from "../shared/protocol";
import { chatTitle, stripContext, withContext, type TabInfo } from "../lib/context";
import { HermesClient, HermesError, toHermesError, type Session } from "../lib/hermes-client";
import { applyEvent, toQuestion, turnsFromHistory, type Approval, type Question, type Turn } from "../lib/hermes-events";

export type HermesState = "connecting" | "connected" | "disconnected" | "refused";

/** Per approval/question: being posted, answered (choice kept), or failed (the owner can try again). */
export type AnswerState = { phase: "posting" | "done" | "error"; choice: string; error?: string };

/** Keep live-only details (approvals, questions, how a run ended) when turns are rebuilt from the stored transcript. */
const merge = (fresh: Turn[], old: Turn[]) =>
  fresh.map((t, i) => {
    const o = old[i];
    if (!o) return t;
    const ended = o.status === "failed" || o.status === "cancelled" ? { status: o.status, error: o.error, errorKind: o.errorKind } : {};
    return { ...t, ...ended, text: t.text || o.text, approvals: o.approvals, questions: o.questions };
  });

const stateOf = (e: HermesError): HermesState => (e.kind === "unauthorized" || e.kind === "forbidden" ? "refused" : e.kind === "network" ? "disconnected" : "connected");

/** The chat: sessions, the open conversation, the live run (stream, approvals, questions), stop and retry. */
export function useChat(settings: Settings) {
  const client = useMemo(() => new HermesClient(settings), [settings]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<HermesError | null>(null);
  const [hermes, setHermes] = useState<HermesState>("connecting");
  const [sessionId, setSessionId] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<HermesError | null>(null);
  const [running, setRunning] = useState(false);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const turnsRef = useRef<Turn[]>([]);
  const runIdRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const epochRef = useRef(0);  // bumped when the open conversation changes: late results of the old one are dropped
  useEffect(() => { turnsRef.current = turns; }, [turns]);

  const noteError = useCallback((e: unknown) => {
    const err = toHermesError(e, settings.hermesUrl);
    setHermes(stateOf(err));
    return err;
  }, [settings.hermesUrl]);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      setSessions(await client.listSessions());
      setSessionsError(null);
      setHermes("connected");
    } catch (e) {
      setSessionsError(noteError(e));
    } finally {
      setSessionsLoading(false);
    }
  }, [client, noteError]);

  useEffect(() => { setHermes("connecting"); if (settings.hermesKey) void loadSessions(); }, [loadSessions, settings.hermesKey]);

  /** Stops the run in progress (if any) and forgets its stream: used when the owner leaves the conversation. */
  const leave = useCallback(() => {
    epochRef.current += 1;
    if (runIdRef.current) client.stop(runIdRef.current).catch(() => {});
    abortRef.current?.abort();
    abortRef.current = null;
    runIdRef.current = "";
    setRunning(false);
  }, [client]);

  const runTurn = useCallback(async (id: string, message: string, history: Turn[]) => {
    const epoch = epochRef.current;
    const alive = () => epoch === epochRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    let live: Turn = { user: message, text: "", steps: [], approvals: [], status: "running" };
    setTurns([...history, live]);
    const show = () => { if (alive()) setTurns((ts) => [...ts.slice(0, -1), live]); };
    let polling = false;
    /** Hermes is asking (clarify): its questions are pending prompts on the run, not stream events, so poll them. */
    const pollQuestions = async () => {
      if (polling) return;
      polling = true;
      while (alive() && live.status === "running" && live.steps.some((s) => s.tool === "clarify" && s.status === "running")) {
        const runId = runIdRef.current;
        const st = runId ? await client.run(runId).catch(() => null) : null;
        const known = new Set((live.questions ?? []).map((q) => q.requestId));
        const fresh = (st?.pending_controls ?? []).filter((c) => c.kind === "clarify" && !known.has(String(c.prompt_id))).map((c) => toQuestion(c, runId));
        if (fresh.length) { live = { ...live, questions: [...(live.questions ?? []), ...fresh] }; show(); }
        await new Promise((r) => setTimeout(r, 1500));
      }
      polling = false;
    };
    try {
      await client.streamChat(id, message, (name, data) => {
        if (!alive()) return;
        if (data.run_id) runIdRef.current = String(data.run_id);
        live = applyEvent(live, name, data);
        show();
        if (name === "tool.started" && data.tool_name === "clarify") void pollQuestions();
      }, controller.signal);
      if (!alive()) return;
      setHermes("connected");
      if (live.status === "running") live = { ...live, status: "done" };  // stream ended without run.completed: the stored transcript decides
      const stored = await client.messages(id).then((m) => turnsFromHistory(m), () => null);
      if (!alive()) return;
      // Use the stored transcript only when it already holds this turn (a stopped run may not have been saved yet).
      if (stored && stored.length > history.length) setTurns(merge(stored, [...history, live]));
      else show();
      void loadSessions();
    } catch (e) {
      if (!alive()) return;
      if (controller.signal.aborted) { live = { ...live, status: "cancelled", error: "Stopped" }; show(); return; }
      const err = noteError(e);
      live = { ...live, status: "failed", error: err.message, errorKind: err.kind };
      show();
    } finally {
      if (alive()) { setRunning(false); runIdRef.current = ""; abortRef.current = null; }
    }
  }, [client, loadSessions, noteError]);

  const start = useCallback(async (message: string, title: string, history: Turn[]) => {
    let id = sessionId;
    if (!id) {
      const epoch = epochRef.current;
      // Stop works while the session is being created too: the same controller cancels the request and, if the
      // answer was already on its way, keeps the run from starting.
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setTurns([...history, { user: message, text: "", steps: [], approvals: [], status: "running" }]);
      const ended = (patch: Partial<Turn>) => setTurns([...history, { user: message, text: "", steps: [], approvals: [], status: "failed", ...patch }]);
      try {
        id = (await client.createChat(title, controller.signal)).id;
      } catch (e) {
        if (epoch !== epochRef.current) return;
        abortRef.current = null;
        if (controller.signal.aborted) ended({ status: "cancelled", error: "Stopped" });
        else { const err = noteError(e); ended({ error: err.message, errorKind: err.kind }); }
        setRunning(false);
        return;
      }
      if (epoch !== epochRef.current) return;
      setSessionId(id);  // kept even when stopped: the next message goes into this chat instead of creating another
      if (controller.signal.aborted) {
        abortRef.current = null;
        ended({ status: "cancelled", error: "Stopped" });
        setRunning(false);
        return;
      }
    }
    await runTurn(id, message, history);
  }, [client, noteError, runTurn, sessionId]);

  /** Sends the owner's text, prefixed with the current-tab context line unless `tab` is null. */
  const send = useCallback(async (text: string, tab: TabInfo | null) => {
    if (running || !text.trim()) return;
    await start(withContext(text.trim(), tab), chatTitle(text), turnsRef.current);
  }, [running, start]);

  /** Re-sends the last turn's message after a failure. */
  const retry = useCallback(async () => {
    const last = turnsRef.current.at(-1);
    if (running || !last) return;
    await start(last.user, chatTitle(stripContext(last.user)), turnsRef.current.slice(0, -1));
  }, [running, start]);

  const stop = useCallback(async () => {
    const runId = runIdRef.current;
    if (runId) await client.stop(runId).catch(() => abortRef.current?.abort());
    else abortRef.current?.abort();  // the run has not announced its id yet
  }, [client]);

  const openSession = useCallback(async (id: string) => {
    leave();
    setSessionId(id);
    setTurns([]);
    setHistoryError(null);
    setHistoryLoading(true);
    const epoch = epochRef.current;
    try {
      const t = turnsFromHistory(await client.messages(id));
      if (epoch === epochRef.current) { setTurns(t); setHermes("connected"); }
    } catch (e) {
      if (epoch === epochRef.current) setHistoryError(noteError(e));
    } finally {
      if (epoch === epochRef.current) setHistoryLoading(false);
    }
  }, [client, leave, noteError]);

  const newChat = useCallback(() => {
    leave();
    setSessionId("");
    setTurns([]);
    setHistoryError(null);
    setHistoryLoading(false);
  }, [leave]);

  const answer = useCallback(async (key: string, choice: string, post: () => Promise<void>) => {
    setAnswers((m) => ({ ...m, [key]: { phase: "posting", choice } }));
    try {
      await post();
      setAnswers((m) => ({ ...m, [key]: { phase: "done", choice } }));
    } catch (e) {
      setAnswers((m) => ({ ...m, [key]: { phase: "error", choice, error: toHermesError(e, settings.hermesUrl).message } }));
    }
  }, [settings.hermesUrl]);

  /** choice "once" approves, "deny" refuses. The card only says Approved after Hermes accepted the answer. */
  const approve = useCallback((a: Approval, choice: "once" | "deny") =>
    answer(a.requestId, choice, () => client.approve(a.runId, a.requestId, a.generation, choice)), [answer, client]);

  const answerQuestion = useCallback((q: Question, text: string) =>
    answer(q.requestId, text, () => client.clarify(q.runId, q.requestId, q.generation, text)), [answer, client]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  return {
    sessions, sessionsLoading, sessionsError, loadSessions, hermes,
    sessionId, turns, historyLoading, historyError, running, answers,
    send, retry, stop, openSession, newChat, approve, answerQuestion,
  };
}
