import "server-only";

// Hotel core's dashboard API (src/hotelcore/api/dashboard.py). Server-side only: the key never reaches the browser.
const BASE = process.env.CORE_API_URL ?? "http://127.0.0.1:8000";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "x-dashboard-key": process.env.DASHBOARD_API_KEY ?? "", ...init?.headers },
  });
  if (!res.ok) throw new Error(`core ${path} -> ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const core = {
  get: <T>(path: string) => call<T>(path),
  post: <T>(path: string) => call<T>(path, { method: "POST" }),
  postJson: <T>(path: string, body: unknown) =>
    call<T>(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
};

export type Stats = {
  days: number; calls: number; duration_s: number; bookings: number; booking_revenue: number; cost_usd: number;
  open_messages: number; intents: { intent: string; n: number }[]; outcomes: { outcome: string; n: number }[];
};
export type CallRow = {
  id: string; started_at: string; duration_s: number; caller_phone: string; intent: string | null; outcome: string | null;
  sentiment: string | null; summary: string | null; booking_id: number | null; booking_amount: number | null; cost_usd: number;
};
export type Turn = { role: string; message?: string; secondsFromStart?: number; name?: string; result?: string;
  toolCalls?: { function: { name: string; arguments: string | object } }[] };
export type CallDetail = CallRow & {
  ended_at: string; ended_reason: string; recording_url: string | null; transcript: string; messages: Turn[];
  tool_calls: { name: string; ok: boolean; error: string | null; ms: number }[];
  team_messages: { id: number; guest_name: string; callback_phone: string; reason: string; status: string }[];
};
export type Booking = { id: number; guest: string; channel: string; booked_at: string; arrival: string; departure: string;
  room: string; status: string; total: number; deposit: number; by_danny: boolean };
export type Bookings = { days: number; revenue: number; collected: number; new_bookings: number; by_danny: number; items: Booking[] };
export type EvalRunRow = { id: number; started_at: string; total: number; passed: number };
export type EvalResult = { name: string; passed: boolean; tool_ok: boolean; reason: string; reply: string; transcript: string[] };
export type EvalRun = EvalRunRow & { results: EvalResult[] };
export type Version = { id: number; created_at: string; author: string; note: string | null };
export type VersionDiff = { version: number; against: number | null; files: Record<string, string> };
export type SmsThread = { guest_phone: string; last_at: string; messages: number; last_body: string };
export type SmsMessage = { created_at: string; direction: "in" | "out"; body: string; tools: { name: string; ok: boolean }[] | null };

export type Check = { ok: boolean; detail: string; failed?: string[] };
export type Review = { summary: string; risk: "Low" | "Medium" | "High"; guest_impact: string; what_to_test: string } | { error: string };
export type ChangeStatus = "checking" | "ready" | "failed" | "applied" | "rejected" | "undone" | "scheduled" | "sending";
export type ChangeRow = {
  id: number; kind: string; title: string; reason: string; status: ChangeStatus; areas: string[]; created_by: string;
  decided_by: string | null; created_at: string; decided_at: string | null; version_id: number | null;
  review: Review | null; paths: string[]; send_at: string | null; recipients: number;
};
export type ChangeFile = { path: string; before: string | null; after: string | null };
export type GuestTextItem = { to: string; name?: string | null; text_name?: string | null; body: string };
export type SentResult = { to: string; name?: string | null; ok: boolean; sid?: string; error?: string };
export type ChangeDetail = Omit<ChangeRow, "review" | "paths" | "recipients"> & {
  files: ChangeFile[]; checks: Record<string, Check> & { review?: Review };
  proposal: { items?: GuestTextItem[] }; sent: SentResult[] | null;
};

export type ReportRow = { id: number; title: string; kind: string; created_at: string; read_at: string | null; preview: string };
export type Report = ReportRow & { body: string };

export type MiniAppRow = { slug: string; title: string; description: string; public: boolean; version: number;
  change_id: number | null; updated_at: string; public_url: string | null };
export type MiniApp = MiniAppRow & { html: string };
