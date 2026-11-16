import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useChat } from "../src/sidepanel/use-chat";
import { HERMES_HELP, SettingsView } from "../src/sidepanel/SettingsView";
import { EXTENSION_ORIGIN } from "../src/lib/hermes-client";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const settings = { hermesUrl: "http://hermes.test", hermesKey: "k", bridgeUrl: "ws://127.0.0.1:8765", bridgeToken: "t" };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const sse = (text: string) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }), { status: 200 });

/** A fake Hermes: `create` answers POST /api/sessions, `stream` answers the chat stream. */
function fakeHermes(over: { create?: (init: RequestInit) => Promise<Response>; stream?: () => Response; messages?: unknown[] } = {}) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    calls.push(`${init.method ?? "GET"} ${path}`);
    if (path === "/api/sessions" && init.method === "POST") return over.create ? over.create(init) : json({ session: { id: "s1" } });
    if (path === "/api/sessions") return json({ data: [] });
    if (path.endsWith("/chat/stream")) return over.stream ? over.stream() : sse("");
    if (path.endsWith("/messages")) return json({ data: over.messages ?? [] });
    return json({});
  }));
  return calls;
}

describe("useChat: a failed turn", () => {
  it("keeps an SSE error through the done event, the end of the stream and the stored transcript", async () => {
    fakeHermes({
      stream: () => sse('event: assistant.delta\ndata: {"delta":"Partial"}\n\nevent: error\ndata: {"message":"Provider timed out"}\n\nevent: done\ndata: {}\n\n'),
      messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "Partial" }],
    });
    const { result } = renderHook(() => useChat(settings));
    await act(async () => { await result.current.send("hi", null); });
    expect(result.current.running).toBe(false);
    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns[0]).toMatchObject({ status: "failed", error: "Provider timed out", text: "Partial" });
  });
});

describe("useChat: Stop while the chat is being created", () => {
  it("cancels the session request and never starts a run", async () => {
    const calls = fakeHermes({
      create: (init) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    });
    const { result } = renderHook(() => useChat(settings));
    let sent!: Promise<void>;
    act(() => { sent = result.current.send("hi", null); });
    expect(result.current.running).toBe(true);
    await act(async () => { await result.current.stop(); await sent; });
    expect(result.current.running).toBe(false);
    expect(result.current.turns[0]).toMatchObject({ status: "cancelled", error: "Stopped" });
    expect(calls.some((c) => c.endsWith("/chat/stream"))).toBe(false);
  });

  it("does not start the run when the session answer arrives after Stop, and keeps that chat for the next message", async () => {
    let answer!: (r: Response) => void;
    const calls = fakeHermes({ create: () => new Promise((ok) => { answer = ok; }) });
    const { result } = renderHook(() => useChat(settings));
    let sent!: Promise<void>;
    act(() => { sent = result.current.send("hi", null); });
    await act(async () => { await result.current.stop(); });
    await act(async () => { answer(json({ session: { id: "s9" } })); await sent; });
    expect(calls.some((c) => c.endsWith("/chat/stream"))).toBe(false);
    expect(result.current.running).toBe(false);
    expect(result.current.sessionId).toBe("s9");
    expect(result.current.turns[0].status).toBe("cancelled");
  });
});

describe("Hermes setup text", () => {
  it("matches the checked-in profile: gateway.api_server, uv run --directory, env token, untrusted", () => {
    expect(HERMES_HELP).toContain("gateway:\n  api_server:\n    cors_origins: " + EXTENSION_ORIGIN);
    expect(HERMES_HELP).not.toContain("platforms:");
    expect(HERMES_HELP).toContain("- --directory");
    expect(HERMES_HELP).not.toContain("--project");
    expect(HERMES_HELP).toContain("env:\n      CHROME_BRIDGE_TOKEN: ${CHROME_BRIDGE_TOKEN}");
    expect(HERMES_HELP).toContain("trust: untrusted");
  });

  it("does not repeat the name in front of a test message that already starts with it", async () => {
    vi.stubGlobal("chrome", { storage: { local: { set: async () => {} }, session: { get: async () => ({ status: { bridge: "unauthorized" } }) } } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    render(<SettingsView initial={{ ...settings, hermesKey: "bad" }} firstRun={false} onSaved={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Test connection" })); });
    const line = (await screen.findAllByRole("status")).map((e) => e.textContent ?? "").find((t) => /refused the API key/.test(t));
    expect(line).toMatch(/^Hermes refused the API key/);
    // another name still gets its label
    expect((await screen.findAllByRole("status")).some((e) => /^Chrome bridge: /.test(e.textContent ?? ""))).toBe(true);
  });
});
