import { sseParser } from "./hermes-events";

/** The origin Hermes must list in `platforms.api_server.cors_origins` (the extension ID is fixed by the manifest key). */
export const EXTENSION_ORIGIN = "chrome-extension://hcedflknbknnjccddacdljlcfgocghod";
export const CORS_ORIGINS_LINE = `cors_origins: ["${EXTENSION_ORIGIN}"]`;

export type HermesErrorKind = "network" | "unauthorized" | "forbidden" | "http";

/** A failed Hermes call with a sentence the owner can act on. */
export class HermesError extends Error {
  constructor(public kind: HermesErrorKind, message: string, public status?: number) {
    super(message);
    this.name = "HermesError";
  }
}

/** HTTP status -> error. 401 = wrong key, 403 = Hermes refused the Origin (not in cors_origins). */
export function errorFromStatus(status: number, body = ""): HermesError {
  if (status === 401) return new HermesError("unauthorized", "Hermes refused the API key. Check the Hermes API key in Settings (API_SERVER_KEY in the Hermes profile .env).", status);
  if (status === 403) return new HermesError("forbidden", `Hermes refused this extension's origin. Add ${EXTENSION_ORIGIN} to platforms.api_server.cors_origins in the Hermes config, then restart Hermes.`, status);
  const detail = body.replace(/\s+/g, " ").trim().slice(0, 200);
  return new HermesError("http", `Hermes answered ${status}${detail ? `: ${detail}` : ""}`, status);
}

export function errorFromNetwork(baseUrl: string): HermesError {
  return new HermesError("network", `Cannot reach Hermes at ${baseUrl}. Is Hermes running? Check the Hermes URL in Settings.`);
}

/** Anything thrown while talking to Hermes -> HermesError (unknown errors keep their message). */
export function toHermesError(e: unknown, baseUrl: string): HermesError {
  if (e instanceof HermesError) return e;
  return e instanceof TypeError ? errorFromNetwork(baseUrl) : new HermesError("http", e instanceof Error ? e.message : String(e));
}

export type Session = { id: string; title: string | null; preview?: string | null; last_active?: number; started_at?: number; model?: string };
export type PendingControl = Record<string, unknown> & { kind?: string; prompt_id?: string };
export type RunState = { status?: string; pending_controls?: PendingControl[] };

export type HermesConfig = { hermesUrl: string; hermesKey: string };

/** Talks straight to the Hermes API server (same endpoints as the dashboard's /api/doss routes). */
export class HermesClient {
  constructor(private cfg: HermesConfig, private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  private base() { return this.cfg.hermesUrl.replace(/\/+$/, ""); }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base()}${path}`, {
        ...init,
        cache: "no-store",
        headers: { Authorization: `Bearer ${this.cfg.hermesKey}`, "Content-Type": "application/json", ...init.headers },
      });
    } catch (e) {
      if (init.signal?.aborted) throw e;
      throw toHermesError(e, this.base());
    }
    if (!res.ok) throw errorFromStatus(res.status, await res.text().catch(() => ""));
    return res;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await this.request(path, init)).json();
  }

  async listSessions(): Promise<Session[]> {
    return (await this.json<{ data?: Session[] }>("/api/sessions?source=api_server&limit=50")).data ?? [];
  }

  async createSession(title: string): Promise<Session> {
    const r = await this.json<{ session?: Session } & Partial<Session>>("/api/sessions", { method: "POST", body: JSON.stringify({ title }) });
    return (r.session ?? r) as Session;
  }

  /** The stored transcript (oldest first). */
  async messages(id: string) {
    const r = await this.json<{ data?: import("./hermes-events").Msg[] }>(`/api/sessions/${id}/messages?limit=500&order=oldest`);
    return r.data ?? [];
  }

  /** One chat turn: feeds each SSE event to onEvent until the stream ends. */
  async streamChat(id: string, message: string, onEvent: (name: string, data: Record<string, unknown>) => void, signal?: AbortSignal): Promise<void> {
    const res = await this.request(`/api/sessions/${id}/chat/stream`, { method: "POST", body: JSON.stringify({ message }), signal, headers: { Accept: "text/event-stream" } });
    if (!res.body) throw new HermesError("http", "Hermes sent an empty response.");
    const feed = sseParser(onEvent);
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    try {
      for (let r = await reader.read(); !r.done; r = await reader.read()) feed(decoder.decode(r.value, { stream: true }));
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new HermesError("network", "The connection to Hermes dropped while it was answering.");
    }
  }

  /** choice: "once" (approve) or "deny". Hermes wants exactly these keys. */
  async approve(runId: string, requestId: string, generation: number, choice: string) {
    await this.request(`/v1/runs/${runId}/approval`, { method: "POST", body: JSON.stringify({ request_id: requestId, execution_generation: generation, choice }) });
  }

  async stop(runId: string) {
    await this.request(`/v1/runs/${runId}/stop`, { method: "POST", body: "{}" });
  }

  async run(runId: string): Promise<RunState> {
    return this.json<RunState>(`/v1/runs/${runId}`);
  }

  async clarify(runId: string, requestId: string, generation: number, answer: string) {
    await this.request(`/v1/runs/${runId}/clarify`, { method: "POST", body: JSON.stringify({ request_id: requestId, execution_generation: generation, answer }) });
  }
}
