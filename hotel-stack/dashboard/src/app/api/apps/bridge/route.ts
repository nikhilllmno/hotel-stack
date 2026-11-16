import { core } from "@/lib/api";

type Params = Record<string, string | number | undefined>;
const q = (p: Params, keys: string[]) =>
  new URLSearchParams(Object.fromEntries(keys.filter((k) => p[k] !== undefined && p[k] !== "").map((k) => [k, String(p[k])])));

/** Data an owner mini app may read (owner decision: everything available). Name -> core read path. */
const SOURCES: Record<string, (p: Params) => string> = {
  reservations: (p) => `/api/live/reservations?${q(p, ["arrival_from", "arrival_to", "status"])}`,
  availability: (p) => `/api/live/availability?${q(p, ["arrival", "departure", "adults", "children"])}`,
  bookings_made: (p) => `/api/bookings?${q(p, ["days"])}`,
  payments: (p) => `/api/payments?${q(p, ["days", "status"])}`,
  call_stats: (p) => `/api/stats?${q(p, ["days"])}`,
  calls: (p) => `/api/calls?${q(p, ["days", "intent", "q", "limit"])}`,
  call: (p) => `/api/calls/${encodeURIComponent(String(p.id))}`,
  text_threads: (p) => `/api/sms?${q(p, ["days"])}`,
  text_thread: (p) => `/api/sms/${encodeURIComponent(String(p.phone))}`,
  team_messages: (p) => `/api/messages?${q(p, ["status"])}`,
  unanswered: (p) => `/api/insights/unanswered?${q(p, ["days"])}`,
  reports: (p) => `/api/reports?${q(p, ["limit", "kind"])}`,
  evals: (p) => `/api/evals?${q(p, ["limit"])}`,
  overview: () => "/api/agents/overview",
  changes: (p) => `/api/changes?${q(p, ["status", "limit"])}`,
  info: () => "/p/api/info",
};

/** What a public page sees, through the same public endpoints as the live /p/<slug> page (so previews match). */
const PUBLIC_SOURCES: Record<string, (p: Params) => string> = {
  availability: (p) => `/p/api/availability?${q(p, ["arrival", "departure", "adults", "children"])}`,
  info: () => "/p/api/info",
};

/** Buttons an owner mini app may press. Texts become proposals (approved on Pending changes as usual). */
const ACTIONS: Record<string, (p: Record<string, unknown>) => Promise<unknown>> = {
  propose_texts: (p) => core.postJson("/api/changes", { guest_texts: p }),
  mark_message_done: (p) => core.post(`/api/messages/${Number(p.id)}/done`),
};

export async function POST(req: Request) {
  const m = await req.json();
  const preview = m.mode === "preview" || m.mode === "public-preview";
  if (m.mode === "public-preview") {
    if (!(m.kind === "get" && PUBLIC_SOURCES[m.source])) {
      return Response.json({ ok: false, error: "a public page can only read availability and info" }, { status: 400 });
    }
    return Response.json({ ok: true, data: await core.get(PUBLIC_SOURCES[m.source](m.params ?? {})) });
  }
  if (preview && m.kind === "act") {
    return Response.json({ ok: false, error: "Preview: buttons work after you approve this app" }, { status: 400 });
  }
  try {
    if (m.kind === "get" && SOURCES[m.source]) return Response.json({ ok: true, data: await core.get(SOURCES[m.source](m.params ?? {})) });
    if (m.kind === "act" && ACTIONS[m.type]) return Response.json({ ok: true, data: await ACTIONS[m.type](m.payload ?? {}) });
    return Response.json({ ok: false, error: `not allowed: ${m.kind} ${m.source ?? m.type}` }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e).replace(/^Error: /, "") }, { status: 502 });
  }
}
