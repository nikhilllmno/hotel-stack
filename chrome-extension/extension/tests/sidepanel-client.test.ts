import { describe, expect, it, vi } from "vitest";
import { CORS_ORIGINS_LINE, EXTENSION_ORIGIN, HermesClient, HermesError, errorFromStatus } from "../src/lib/hermes-client";

const cfg = { hermesUrl: "http://127.0.0.1:8642/", hermesKey: "secret" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const client = (impl: (url: string, init?: RequestInit) => Promise<Response>) => new HermesClient(cfg, impl as unknown as typeof fetch);

describe("error mapping", () => {
  it("401 means the key was refused", async () => {
    const e = await client(async () => new Response("no", { status: 401 })).listSessions().catch((x) => x);
    expect(e).toBeInstanceOf(HermesError);
    expect(e).toMatchObject({ kind: "unauthorized", status: 401 });
    expect(e.message).toContain("API key");
  });

  it("403 means the origin was refused and names the cors_origins entry", async () => {
    const e = await client(async () => new Response("forbidden", { status: 403 })).listSessions().catch((x) => x);
    expect(e).toMatchObject({ kind: "forbidden", status: 403 });
    expect(e.message).toContain(EXTENSION_ORIGIN);
    expect(e.message).toContain("gateway.api_server.cors_origins");
    expect(e.message).not.toContain("platforms.");
    expect(CORS_ORIGINS_LINE).toBe("cors_origins: chrome-extension://hcedflknbknnjccddacdljlcfgocghod");
  });

  it("a failed fetch means Hermes is unreachable", async () => {
    const e = await client(async () => { throw new TypeError("Failed to fetch"); }).listSessions().catch((x) => x);
    expect(e).toMatchObject({ kind: "network" });
    expect(e.message).toContain("http://127.0.0.1:8642");
  });

  it("other statuses carry the body", () => {
    expect(errorFromStatus(500, "  boom \n here")).toMatchObject({ kind: "http", status: 500, message: "Hermes answered 500: boom here" });
  });
});

describe("requests", () => {
  it("sends the bearer key and the dashboard's endpoints and bodies", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const c = client(async (url, init) => { calls.push([url, init]); return json({ data: [], session: { id: "s1" } }); });
    await c.listSessions();
    await c.createSession("Chrome: hi");
    await c.messages("s1");
    await c.approve("r1", "q1", 4, "once");
    await c.clarify("r1", "q2", 4, "Ranch");
    await c.stop("r1");
    await c.run("r1");
    expect(calls.map(([u, i]) => `${i?.method ?? "GET"} ${u}`)).toEqual([
      "GET http://127.0.0.1:8642/api/sessions?source=api_server&limit=50",
      "POST http://127.0.0.1:8642/api/sessions",
      "GET http://127.0.0.1:8642/api/sessions/s1/messages?limit=500&offset=0&order=latest",
      "POST http://127.0.0.1:8642/v1/runs/r1/approval",
      "POST http://127.0.0.1:8642/v1/runs/r1/clarify",
      "POST http://127.0.0.1:8642/v1/runs/r1/stop",
      "GET http://127.0.0.1:8642/v1/runs/r1",
    ]);
    expect((calls[0][1]?.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    expect(JSON.parse(String(calls[1][1]?.body))).toEqual({ title: "Chrome: hi" });
    expect(JSON.parse(String(calls[3][1]?.body))).toEqual({ request_id: "q1", execution_generation: 4, choice: "once" });
    expect(JSON.parse(String(calls[4][1]?.body))).toEqual({ request_id: "q2", execution_generation: 4, answer: "Ranch" });
    expect(calls[5][1]?.body).toBe("{}");
  });

  it("createSession accepts the session at the top level or wrapped", async () => {
    expect((await client(async () => json({ session: { id: "a" } })).createSession("t")).id).toBe("a");
    expect((await client(async () => json({ id: "b" })).createSession("t")).id).toBe("b");
  });

  it("probe passes when the sessions list works and the stop probe answers 404, and fails on a 403 from the POST", async () => {
    const ok = client(async (url, init) => (init?.method === "POST" ? json({ error: { code: "run_not_found" } }, 404) : json({ data: [] })));
    await expect(ok.probe()).resolves.toBeUndefined();
    const noOrigin = client(async (url, init) => (init?.method === "POST" ? new Response("{}", { status: 403 }) : json({ data: [] })));
    await expect(noOrigin.probe()).rejects.toMatchObject({ kind: "forbidden", status: 403 });
    const badKey = client(async () => new Response("no", { status: 401 }));
    await expect(badKey.probe()).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("createChat retries with a numbered title while Hermes says the title is already in use", async () => {
    const taken = () => json({ error: { message: "Title 'Chrome: hi' is already in use by session x", code: "invalid_title" } }, 400);
    const titles: string[] = [];
    const c = client(async (_url, init) => {
      const t = JSON.parse(String(init?.body)).title as string;
      titles.push(t);
      return titles.length < 3 ? taken() : json({ session: { id: "ok" } });
    });
    expect((await c.createChat("Chrome: hi")).id).toBe("ok");
    expect(titles).toEqual(["Chrome: hi", "Chrome: hi (2)", "Chrome: hi (3)"]);
  });

  it("createChat does not retry other errors", async () => {
    let n = 0;
    const e = await client(async () => { n++; return new Response("nope", { status: 401 }); }).createChat("t").catch((x) => x);
    expect(e).toMatchObject({ kind: "unauthorized" });
    expect(n).toBe(1);
  });

  it("streams chat events across chunk boundaries", async () => {
    const enc = new TextEncoder();
    const parts = ['event: assistant.delta\ndata: {"delta":"A"}\n', '\nevent: run.completed\ndata: {"messages":[]}\n\n'];
    const body = new ReadableStream({ start(ctl) { parts.forEach((p) => ctl.enqueue(enc.encode(p))); ctl.close(); } });
    const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
    const events: string[] = [];
    await client(fetchMock as never).streamChat("s1", "hi", (n) => events.push(n));
    expect(events).toEqual(["assistant.delta", "run.completed"]);
    const init = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[0]).toBe("http://127.0.0.1:8642/api/sessions/s1/chat/stream");
    expect(JSON.parse(String(init[1].body))).toEqual({ message: "hi" });
  });

  it("maps 403 on the stream too", async () => {
    const e = await client(async () => new Response("x", { status: 403 })).streamChat("s1", "hi", () => {}).catch((x) => x);
    expect(e).toMatchObject({ kind: "forbidden" });
  });
});

describe("history paging", () => {
  const msg = (i: number) => ({ role: "user", content: `m${i}` });
  it("reads the newest page first so a long chat shows its latest messages, then adds older pages in order", async () => {
    const urls: string[] = [];
    const c = client(async (url) => {
      urls.push(url);
      const offset = Number(new URL(url).searchParams.get("offset"));
      // 1200 messages m0..m1199; order=latest pages back from the newest but each page is chronological
      const end = 1200 - offset, start = Math.max(0, end - 500);
      return json({ data: Array.from({ length: end - start }, (_, i) => msg(start + i)) });
    });
    const all = await c.messages("s1");
    expect(urls.map((u) => new URL(u).search)).toEqual([
      "?limit=500&offset=0&order=latest", "?limit=500&offset=500&order=latest", "?limit=500&offset=1000&order=latest",
    ]);
    expect(all).toHaveLength(1200);
    expect(all[0].content).toBe("m0");
    expect(all.at(-1)?.content).toBe("m1199");
  });

  it("stops after a short page, and caps the pages it reads", async () => {
    let calls = 0;
    await client(async () => { calls++; return json({ data: [msg(1)] }); }).messages("s1");
    expect(calls).toBe(1);
    calls = 0;
    const all = await client(async () => { calls++; return json({ data: Array.from({ length: 500 }, (_, i) => msg(i)) }); }).messages("s1");
    expect(calls).toBe(4);
    expect(all).toHaveLength(2000);
  });
});

describe("createChat cancellation", () => {
  it("passes the abort signal to the session request and stops retrying titles once aborted", async () => {
    const ctrl = new AbortController();
    const seen: (AbortSignal | undefined | null)[] = [];
    const c = client(async (_url, init) => {
      seen.push(init?.signal);
      ctrl.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await expect(c.createChat("Hi", ctrl.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toEqual([ctrl.signal]);
  });
});
