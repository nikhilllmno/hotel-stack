import {
  PROTOCOL_VERSION,
  type BridgeStatus,
  type BridgeToExtension,
  type CommandMessage,
  type ExtensionToBridge,
  type ResultMessage,
  type Settings,
} from "../shared/protocol";

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
  runCommand(msg: CommandMessage): Promise<ResultMessage>;
  setBridgeState(state: BridgeStatus["bridge"]): Promise<void>;
  hello(): { extension_version: string; user_agent: string };
};

const OPEN = 1;

/** Keeps one WebSocket to the chrome bridge alive and hands its commands to runCommand, one at a time. */
export class BridgeClient {
  private socket: SocketLike | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private backoff = BACKOFF_MIN_MS;
  private unauthorized = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(private deps: BridgeDeps) {}

  /** Connect unless a connection or a retry is already underway. Safe to call from alarms and on every wake-up. */
  async ensureConnected(): Promise<void> {
    if (this.socket && this.socket.readyState <= OPEN) return;
    clearTimeout(this.retryTimer);
    await this.connect();
  }

  /** Drop the current connection and connect again with the latest settings. */
  async reconnect(): Promise<void> {
    this.disconnect();
    this.backoff = BACKOFF_MIN_MS;
    this.unauthorized = false;
    await this.connect();
  }

  private disconnect(): void {
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
    const settings = await this.deps.loadSettings();
    if (!settings.bridgeToken) {
      await this.deps.setBridgeState("disconnected");
      return;
    }
    const url = new URL(settings.bridgeUrl);
    url.searchParams.set("token", settings.bridgeToken);
    if (!this.unauthorized) await this.deps.setBridgeState("connecting");
    const socket = this.deps.openSocket(url.toString());
    this.socket = socket;
    let opened = false;
    socket.onopen = () => {
      opened = true;
      this.backoff = BACKOFF_MIN_MS;
      this.unauthorized = false;
      const hello: ExtensionToBridge = { type: "hello", protocol: PROTOCOL_VERSION, ...this.deps.hello() };
      socket.send(JSON.stringify(hello));
      this.pingTimer = setInterval(() => socket.send(JSON.stringify({ type: "ping" })), PING_MS);
      void this.deps.setBridgeState("connected");
    };
    socket.onmessage = (e) => this.onMessage(socket, String(e.data));
    socket.onclose = (e) => void this.onClose(socket, url, opened, e.code);
  }

  private onMessage(socket: SocketLike, raw: string): void {
    const msg = JSON.parse(raw) as BridgeToExtension;
    if (msg.type === "ping") socket.send(JSON.stringify({ type: "pong" }));
    if (msg.type !== "command") return;
    this.queue = this.queue.then(async () => {
      const result = await this.deps.runCommand(msg);
      if (socket.readyState === OPEN) socket.send(JSON.stringify(result));
    });
  }

  private async onClose(socket: SocketLike, url: URL, opened: boolean, code: number): Promise<void> {
    if (this.socket !== socket) return;
    clearInterval(this.pingTimer);
    this.socket = undefined;
    // A refused handshake and a bridge that is down both end as code 1006; only the HTTP status tells them apart.
    if (UNAUTHORIZED_CLOSE_CODES.includes(code) || (!opened && (await this.refusedByBridge(url)))) {
      this.unauthorized = true;
      await this.deps.setBridgeState("unauthorized");
    } else {
      await this.deps.setBridgeState("disconnected");
    }
    if (code === REPLACED) return;
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
