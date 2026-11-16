import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeClient, type BridgeDeps, type SocketLike } from "../src/background/bridge";
import type { CommandMessage, ResultMessage, Settings } from "../src/shared/protocol";

class FakeSocket {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}

const settings = (over: Partial<Settings> = {}): Settings => ({ hermesUrl: "", hermesKey: "", bridgeUrl: "ws://127.0.0.1:8765", bridgeToken: "tok", ...over });

let sockets: FakeSocket[];
let states: string[];
let current: Settings;
let probe: number | undefined;
let run: (m: CommandMessage) => Promise<ResultMessage>;
let hold: Promise<void> | undefined;  // makes the next loadSettings wait; it still answers with the settings of the moment it was called
let probeGate: Promise<void> | undefined;

const client = () => {
  const deps: BridgeDeps = {
    loadSettings: async () => {
      const mine = current;
      if (hold) { const h = hold; hold = undefined; await h; }
      return mine;
    },
    openSocket: (url) => { const s = new FakeSocket(url); sockets.push(s); return s as unknown as SocketLike; },
    probeHttpStatus: async () => { await probeGate; return probe; },
    runCommand: (m) => run(m),
    setBridgeState: async (s) => { states.push(s); },
    hello: () => ({ extension_version: "0.1.0", user_agent: "UA" }),
  };
  return new BridgeClient(deps);
};
const last = () => sockets[sockets.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
  sockets = []; states = []; current = settings(); probe = undefined; hold = undefined; probeGate = undefined;
  run = async (m) => ({ type: "result", id: m.id, ok: true, text: "ok" });
});
afterEach(() => vi.useRealTimers());

describe("BridgeClient", () => {
  it("connects with the token, says hello and reports connected", async () => {
    await client().ensureConnected();
    expect(last().url).toBe("ws://127.0.0.1:8765/?token=tok");
    expect(states).toEqual(["connecting"]);
    last().open();
    expect(last().sent[0]).toEqual({ type: "hello", protocol: 1, extension_version: "0.1.0", user_agent: "UA" });
    expect(states).toEqual(["connecting", "connected"]);
  });

  it("does not connect without a token", async () => {
    current = settings({ bridgeToken: "" });
    await client().ensureConnected();
    expect(sockets).toHaveLength(0);
    expect(states).toEqual(["disconnected"]);
  });

  it("pings every 20 s and answers pings", async () => {
    await client().ensureConnected();
    last().open();
    vi.advanceTimersByTime(40_000);
    expect(last().sent.filter((m) => m.type === "ping")).toHaveLength(2);
    last().receive({ type: "ping" });
    expect(last().sent.at(-1)).toEqual({ type: "pong" });
  });

  it("runs commands one at a time and sends each result back", async () => {
    const order: string[] = [];
    run = async (m) => {
      order.push(`start ${m.id}`);
      await new Promise((r) => setTimeout(r, 100));
      order.push(`end ${m.id}`);
      return { type: "result", id: m.id, ok: true, text: m.id };
    };
    await client().ensureConnected();
    last().open();
    for (const id of ["1", "2"]) last().receive({ type: "command", id, name: "tabs", args: {}, approved: false });
    await vi.advanceTimersByTimeAsync(300);
    expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"]);
    expect(last().sent.filter((m) => m.type === "result").map((m) => m.id)).toEqual(["1", "2"]);
  });

  it("reconnects with backoff 1 s, 2 s, ... up to 30 s, and resets after a successful connect", async () => {
    const c = client();
    await c.ensureConnected();
    for (const wait of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      const before = sockets.length;
      last().drop();
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(sockets).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(before + 1);
    }
    last().open();
    last().drop(1001);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(9);
    expect(states).toContain("disconnected");
  });

  it("is unauthorized when the bridge refuses the handshake (HTTP 401/403) or closes with policy code", async () => {
    probe = 401;
    await client().ensureConnected();
    last().drop(1006);
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toBe("unauthorized");

    states = []; probe = undefined;
    const c = client();
    await c.ensureConnected();
    last().open();
    last().drop(1008);
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toBe("unauthorized");
  });

  it("is disconnected, not unauthorized, when the bridge is simply down", async () => {
    await client().ensureConnected();
    last().drop(1006);
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toBe("disconnected");
  });

  it("ensureConnected does nothing while a socket is open or connecting; reconnect replaces it with new settings", async () => {
    const c = client();
    await c.ensureConnected();
    await c.ensureConnected();
    expect(sockets).toHaveLength(1);
    current = settings({ bridgeToken: "new" });
    await c.reconnect();
    expect(sockets).toHaveLength(2);
    expect(last().url).toContain("token=new");
    expect(sockets[0].readyState).toBe(3);
  });

  it("stays disconnected after another Chrome replaced this connection until the next wake-up", async () => {
    const c = client();
    await c.ensureConnected();
    last().open();
    last().drop(4000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    await c.ensureConnected();
    expect(sockets).toHaveLength(2);
  });
});

const command = (id: string) => ({ type: "command", id, name: "tabs", args: {}, approved: false });
const gate = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r; }); return { p, open }; };

describe("BridgeClient connection generations", () => {
  it("does not run commands that were queued on a connection that has since closed", async () => {
    const started: string[] = [];
    const slow = gate();
    run = async (m) => {
      started.push(m.id);
      if (m.id === "1") await slow.p;
      return { type: "result", id: m.id, ok: true, text: m.id };
    };
    const c = client();
    await c.ensureConnected();
    const a = last();
    a.open();
    a.receive(command("1"));
    a.receive(command("2"));
    a.receive(command("3"));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(["1"]);
    a.drop();
    await vi.advanceTimersByTimeAsync(1_000);   // retry connects a new socket
    expect(sockets).toHaveLength(2);
    slow.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(["1"]);             // 2 and 3 belonged to the closed connection
    expect(a.sent.filter((m) => m.type === "result")).toHaveLength(0);
    expect(last().sent.filter((m) => m.type === "result")).toHaveLength(0);
  });

  it("does not make the new connection wait behind a command of the old one", async () => {
    const never = gate();
    run = async (m) => (m.id === "old" ? never.p.then(() => ({ type: "result", id: m.id, ok: true, text: "" }) as ResultMessage) : { type: "result", id: m.id, ok: true, text: m.id });
    const c = client();
    await c.ensureConnected();
    last().open();
    last().receive(command("old"));
    await vi.advanceTimersByTimeAsync(0);
    last().drop();
    await vi.advanceTimersByTimeAsync(1_000);
    last().open();
    last().receive(command("new"));
    await vi.advanceTimersByTimeAsync(0);
    expect(last().sent.filter((m) => m.type === "result").map((m) => m.id)).toEqual(["new"]);
  });

  it("does not send the result of a command that finished after reconnect, nor run later ones", async () => {
    const slow = gate();
    const started: string[] = [];
    run = async (m) => { started.push(m.id); await slow.p; return { type: "result", id: m.id, ok: true, text: m.id }; };
    const c = client();
    await c.ensureConnected();
    const a = last();
    a.open();
    a.receive(command("1"));
    a.receive(command("2"));
    await vi.advanceTimersByTimeAsync(0);
    await c.reconnect();
    last().open();
    slow.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(["1"]);
    expect(last().sent.filter((m) => m.type === "result")).toHaveLength(0);
  });

  it("ignores messages, opens and closes from a socket that was replaced", async () => {
    const c = client();
    await c.ensureConnected();
    const a = last();
    await c.reconnect();
    const b = last();
    b.open();
    a.open();
    a.receive(command("1"));
    a.receive({ type: "ping" });
    a.drop(1008);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(a.sent).toEqual([]);
    expect(states.at(-1)).toBe("connected");
    expect(sockets).toHaveLength(2);
  });

  it("a close whose HTTP probe is still running does not overwrite a newer connection or schedule a retry", async () => {
    const g = gate();
    probeGate = g.p;
    probe = 401;
    const c = client();
    await c.ensureConnected();
    const a = last();
    a.drop(1006);                       // never opened: the client probes HTTP before it decides
    await vi.advanceTimersByTimeAsync(0);
    await c.reconnect();                // meanwhile the owner changes settings
    last().open();
    g.open();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(states.at(-1)).toBe("connected");
    expect(states).not.toContain("unauthorized");
    expect(sockets).toHaveLength(2);
  });

  it("opens a single socket when ensureConnected is called again while the first call is still loading settings", async () => {
    const g = gate();
    hold = g.p;
    const c = client();
    const first = c.ensureConnected();
    const second = c.ensureConnected();
    const third = c.ensureConnected();
    g.open();
    await Promise.all([first, second, third]);
    expect(sockets).toHaveLength(1);
    expect(states).toEqual(["connecting"]);
  });

  it("a reconnect during an in-flight connect uses the new settings and leaves one socket", async () => {
    const g = gate();
    hold = g.p;
    const c = client();
    const first = c.ensureConnected();    // reads the old token, then waits
    current = settings({ bridgeToken: "new" });
    const second = c.reconnect();
    g.open();
    await Promise.all([first, second]);
    expect(sockets).toHaveLength(1);
    expect(last().url).toContain("token=new");
  });

  it("lets a later ensureConnected start a new connect after the first one finished", async () => {
    const c = client();
    await c.ensureConnected();
    last().drop(4000);
    await vi.advanceTimersByTimeAsync(0);
    await c.ensureConnected();
    expect(sockets).toHaveLength(2);
  });
});
