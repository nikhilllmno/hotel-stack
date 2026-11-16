import {
  PROTOCOL_VERSION,
  type BridgeStatus,
  type BridgeToExtension,
  type CommandMessage,
  type ExtensionToBridge,
  type ResultMessage,
  type Settings,
} from "../shared/protocol";
import { enqueue } from "./lane";

const PING_MS = 20_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
/** The bridge closes the old connection with this code when another Chrome connects. */
const REPLACED = 4000;
const UNAUTHORIZED_CLOSE_CODES = [1008, 4401, 4403];

/** The few WebSocket members the client uses, so tests can fake it. */
export type SocketLike = Pick<WebSocket, "readyState" | "send" | "close" | "onopen" | "onmessage" | "onclose">;

export type BridgeDeps = {
  loadSettings(): Promise<Settings>;
  openSocket(url: string): SocketLike;
  /** Plain HTTP status of the bridge URL (browsers hide the handshake status), or undefined if unreachable. */
  probeHttpStatus(url: string): Promise<number | undefined>;
  /** `isCurrent` turns false once the connection that sent the command is replaced or closed. */
  runCommand(msg: CommandMessage, isCurrent: () => boolean): Promise<ResultMessage>;
  setBridgeState(state: BridgeStatus["bridge"]): Promise<void>;
  hello(): { extension_version: string; user_agent: string };
};

const OPEN = 1;

/** Keeps one WebSocket to the chrome bridge alive and hands its commands to runCommand, one at a time (the lane is shared by every connection). */
export class BridgeClient {
  private socket: SocketLike | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private backoff = BACKOFF_MIN_MS;
  private unauthorized = false;
  /**
   * Bumped whenever a connection starts, is dropped or closes. A socket, a queued command or a half-finished connect
   * that carries an older number is stale and must do nothing: it may not start commands, send results or touch state.
   * A command that is already running cannot be recalled; it sees the change through isCurrent and stops before its next change to Chrome.
   */
  private generation = 0;
  private inflight: Promise<void> | undefined;

  constructor(private deps: BridgeDeps) {}

  /** Connect unless a connection, a connect in progress or a retry is already underway. Safe to call from alarms and on every wake-up. */
  ensureConnected(): Promise<void> {
    if (this.socket && this.socket.readyState <= OPEN) return Promise.resolve();
    if (this.inflight) return this.inflight;
    clearTimeout(this.retryTimer);
    return this.startConnect();
  }

  /** Drop the current connection and connect again with the latest settings. */
  reconnect(): Promise<void> {
    this.disconnect();
    this.backoff = BACKOFF_MIN_MS;
    this.unauthorized = false;
    return this.startConnect();
  }

  private startConnect(): Promise<void> {
    const p: Promise<void> = this.connect().finally(() => {
      if (this.inflight === p) this.inflight = undefined;
    });
    this.inflight = p;
    return p;
  }

  private disconnect(): void {
    this.generation++;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    const old = this.socket;
    this.socket = undefined;
    if (old) {
      old.onclose = null;
      old.close();
    }
  }

  private async connect(): Promise<void> {
    const gen = ++this.generation;
    const settings = await this.deps.loadSettings();
    if (gen !== this.generation) return;
    if (!settings.bridgeToken) {
      await this.deps.setBridgeState("disconnected");
      return;
    }
    const url = new URL(settings.bridgeUrl);
    url.searchParams.set("token", settings.bridgeToken);
    if (!this.unauthorized) await this.deps.setBridgeState("connecting");
    if (gen !== this.generation) return;
    const socket = this.deps.openSocket(url.toString());
    this.socket = socket;
    let opened = false;
    const current = () => gen === this.generation && this.socket === socket;
    socket.onopen = () => {
      if (!current()) return;
      opened = true;
      this.backoff = BACKOFF_MIN_MS;
      this.unauthorized = false;
      const hello: ExtensionToBridge = { type: "hello", protocol: PROTOCOL_VERSION, ...this.deps.hello() };
      socket.send(JSON.stringify(hello));
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (current() && socket.readyState === OPEN) socket.send(JSON.stringify({ type: "ping" }));
      }, PING_MS);
      void this.deps.setBridgeState("connected");
    };
    socket.onmessage = (e) => {
      if (current()) this.onMessage(socket, gen, String(e.data));
    };
    socket.onclose = (e) => {
      if (current()) void this.onClose(socket, url, opened, e.code);
    };
  }

  private onMessage(socket: SocketLike, gen: number, raw: string): void {
    const msg = JSON.parse(raw) as BridgeToExtension;
    if (msg.type === "ping") socket.send(JSON.stringify({ type: "pong" }));
    if (msg.type !== "command") return;
    const isCurrent = () => gen === this.generation;
    void enqueue(async () => {
      // The connection may have closed while this command waited: its owner is gone, so do not run it.
      if (!isCurrent()) return;
      const result = await this.deps.runCommand(msg, isCurrent);
      if (isCurrent() && socket.readyState === OPEN) socket.send(JSON.stringify(result));
    });
  }

  private async onClose(socket: SocketLike, url: URL, opened: boolean, code: number): Promise<void> {
    if (this.socket !== socket) return;
    const closedGen = ++this.generation;
    clearInterval(this.pingTimer);
    this.socket = undefined;
    // A refused handshake and a bridge that is down both end as code 1006; only the HTTP status tells them apart.
    const refused = UNAUTHORIZED_CLOSE_CODES.includes(code) || (!opened && (await this.refusedByBridge(url)));
    if (this.generation !== closedGen) return;  // a reconnect started while the probe ran
    if (refused) {
      this.unauthorized = true;
      await this.deps.setBridgeState("unauthorized");
    } else {
      await this.deps.setBridgeState("disconnected");
    }
    if (this.generation !== closedGen || code === REPLACED) return;
    this.retryTimer = setTimeout(() => void this.ensureConnected(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS);
  }

  private async refusedByBridge(url: URL): Promise<boolean> {
    const http = new URL(url);
    http.protocol = url.protocol === "wss:" ? "https:" : "http:";
    const status = await this.deps.probeHttpStatus(http.toString());
    return status === 401 || status === 403;
  }
}
