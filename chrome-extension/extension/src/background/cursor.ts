import type { Target } from "./debugger";

/**
 * The agent cursor: a purely cosmetic overlay that shows the owner what Hermes is doing in the tab (an arrow that glides
 * to each mouse target, a click pulse, a pill with "Typing..." or the key, and a frame around the page while commands
 * run). Nothing here may change what a command does: every call swallows its own failure, and the real input still goes
 * through CDP exactly where it did before (no intermediate mouseMoved events).
 */

/** Colours, sizes and timing in one place. Colours follow src/styles.css (primary, primary-foreground, ring, radius); the accent is the one extra, picked to read on light and dark pages. */
export const CURSOR_STYLE = {
  primary: "oklch(0.205 0 0)",
  primaryForeground: "oklch(0.985 0 0)",
  ring: "oklch(0.708 0 0)",
  radius: "0.625rem",
  accent: "#6366f1",
  outline: "#ffffff",           // outline of the arrow and the pill, so they read on a dark page
  shadow: "rgba(0, 0, 0, 0.35)",
  cursorSize: 24,               // px, the SVG arrow
  pillText: "Hermes",
  frameText: "Hermes is using this tab",
  frameWidth: 2,                // px, inset border of the frame
  glowSize: 28,                 // px, blur of the inset glow
  pulseMs: 350,
  pulseSize: 44,                // px, final diameter of the click ring
  fadeMs: 250,
  idleMs: 8000,                 // fade out after this long without a command
  keyMs: 1200,                  // how long a pressed key stays in the pill
  zIndex: 2147483647,
} as const;

export type CursorStyle = typeof CURSOR_STYLE;

/** Glide time by distance: 180 ms for a short hop up to 600 ms for a long one. `undefined` (first appearance) takes a middle value. */
export const GLIDE_MIN_MS = 180;
export const GLIDE_MAX_MS = 600;
export const glideMs = (distance: number | undefined): number =>
  distance === undefined || !Number.isFinite(distance) ? 320 : Math.round(Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, GLIDE_MIN_MS + distance * 0.4)));

type Point = { x: number; y: number };

export type CursorRequest =
  | { op: "move"; x: number; y: number; from?: Point; ms: number; pulse: boolean }
  | { op: "say"; text: string | null; ttl?: number }
  | { op: "busy" }
  | { op: "hide" }
  | { op: "show" };

/**
 * Runs inside the tab (chrome.scripting, ISOLATED world), so it must stay self-contained: it can use nothing from this
 * module except what arrives in `s`. The overlay is one element on documentElement (outside body, so the snapshot walk
 * and innerText never see it) with a closed shadow root; everything inside has pointer-events: none. State lives in
 * the isolated world, out of the page's reach. Returns after a glide has finished.
 */
export function hermesCursor(req: CursorRequest, s: CursorStyle): Promise<void> | void {
  type Overlay = { host: HTMLElement; wrap: HTMLElement; arrow: HTMLElement; pill: HTMLElement };
  type Timer = ReturnType<typeof setTimeout>;
  const w = globalThis as unknown as { __hermesCursor?: { x: number; y: number; shot: boolean; idle?: Timer; say?: Timer; unhide?: Timer; o?: Overlay } };
  const mem = (w.__hermesCursor ??= { x: NaN, y: NaN, shot: false });
  const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const css = `
    :host { all: initial; position: fixed; inset: 0; pointer-events: none; z-index: ${s.zIndex};
      --hermes-primary: ${s.primary}; --hermes-primary-foreground: ${s.primaryForeground}; --hermes-ring: ${s.ring};
      --hermes-radius: ${s.radius}; --hermes-accent: ${s.accent}; --hermes-outline: ${s.outline}; --hermes-shadow: ${s.shadow}; }
    :host([data-shot]) { display: none; }
    * { pointer-events: none !important; box-sizing: border-box; }
    .frame { position: fixed; inset: 0; opacity: 0; transition: opacity ${s.fadeMs}ms ease;
      box-shadow: inset 0 0 0 ${s.frameWidth}px var(--hermes-accent), inset 0 0 ${s.glowSize}px color-mix(in srgb, var(--hermes-accent) 55%, transparent); }
    .label { opacity: 0; transition: opacity ${s.fadeMs}ms ease; position: fixed; top: 8px; left: 50%; transform: translateX(-50%); max-width: calc(100vw - 16px); overflow: hidden;
      white-space: nowrap; text-overflow: ellipsis; padding: 4px 12px; border-radius: var(--hermes-radius); font: 500 12px/16px system-ui, sans-serif;
      background: var(--hermes-primary); color: var(--hermes-primary-foreground); box-shadow: 0 0 0 1px var(--hermes-ring), 0 2px 8px var(--hermes-shadow); }
    .on .frame, .on .cursor, .on .label { opacity: 1; }
    .cursor { position: fixed; left: 0; top: 0; opacity: 0; transition: opacity ${s.fadeMs}ms ease; will-change: transform; }
    .cursor svg { display: block; width: ${s.cursorSize}px; height: ${s.cursorSize}px; filter: drop-shadow(0 1px 2px var(--hermes-shadow)); }
    .pill { position: absolute; left: ${Math.round(s.cursorSize * 0.7)}px; top: ${Math.round(s.cursorSize * 0.8)}px; white-space: nowrap; padding: 2px 8px;
      border-radius: var(--hermes-radius); font: 600 12px/16px system-ui, sans-serif; background: var(--hermes-accent); color: var(--hermes-primary-foreground);
      box-shadow: 0 0 0 1.5px var(--hermes-outline), 0 2px 6px var(--hermes-shadow); }
    .flip .pill { left: auto; right: ${Math.round(s.cursorSize * 0.3)}px; }
    .ring { position: fixed; left: 0; top: 0; width: ${s.pulseSize}px; height: ${s.pulseSize}px; margin: -${s.pulseSize / 2}px 0 0 -${s.pulseSize / 2}px;
      border-radius: 50%; border: 2px solid var(--hermes-accent); background: color-mix(in srgb, var(--hermes-accent) 25%, transparent); opacity: 0; }
  `;

  const build = (): Overlay => {
    const host = document.createElement("hermes-agent-cursor");
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = css;
    const wrap = document.createElement("div");
    wrap.innerHTML =
      `<div class="frame"></div><div class="label"></div>` +
      `<div class="cursor"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 2 L3 18.5 L7.6 14.4 L10.6 21.2 L13.6 19.9 L10.7 13.2 L17 13 Z" fill="${s.accent}" stroke="${s.outline}" stroke-width="1.6" stroke-linejoin="round"/></svg><div class="pill"></div></div>`;
    root.append(style, wrap);
    (wrap.querySelector(".label") as HTMLElement).textContent = s.frameText;
    const arrow = wrap.querySelector(".cursor") as HTMLElement;
    const pill = wrap.querySelector(".pill") as HTMLElement;
    pill.textContent = s.pillText;
    document.documentElement.append(host);
    return { host, wrap, arrow, pill };
  };

  /** The overlay, created when missing or when the page removed it (a SPA re-render, document.documentElement.innerHTML = ...). */
  const overlay = (): Overlay => {
    let o = mem.o;
    if (!o || !o.host.isConnected) o = mem.o = build();
    if (mem.shot) o.host.setAttribute("data-shot", "");
    return o;
  };

  const place = (o: Overlay, x: number, y: number) => {
    mem.x = x;
    mem.y = y;
    o.arrow.style.transform = `translate(${x}px, ${y}px)`;
    o.arrow.classList.toggle("flip", x > innerWidth - 140);  // keep the pill inside the viewport
  };

  /** Shows the cursor and the frame, and fades both out after `idleMs` without a command. */
  const wake = (o: Overlay) => {
    o.wrap.classList.add("on");
    clearTimeout(mem.idle);
    mem.idle = setTimeout(() => mem.o?.wrap.classList.remove("on"), s.idleMs);
  };

  const text = (o: Overlay, t: string) => void (o.pill.textContent = t);

  switch (req.op) {
    case "hide":
      mem.shot = true;
      mem.o?.host.setAttribute("data-shot", "");
      clearTimeout(mem.unhide);
      mem.unhide = setTimeout(() => {  // a screenshot that never came back must not leave the cursor hidden for good
        mem.shot = false;
        mem.o?.host.removeAttribute("data-shot");
      }, 15_000);
      return;
    case "show":
      mem.shot = false;
      clearTimeout(mem.unhide);
      mem.o?.host.removeAttribute("data-shot");
      return;
    case "busy": {
      const o = overlay();
      if (Number.isNaN(mem.x)) place(o, innerWidth / 2, innerHeight / 2);
      wake(o);
      return;
    }
    case "say": {
      const o = overlay();
      if (Number.isNaN(mem.x)) place(o, innerWidth / 2, innerHeight / 2);
      clearTimeout(mem.say);
      text(o, req.text ?? s.pillText);
      if (req.text && req.ttl) mem.say = setTimeout(() => mem.o && text(mem.o, s.pillText), req.ttl);
      wake(o);
      return;
    }
    case "move": {
      const o = overlay();
      clearTimeout(mem.say);
      text(o, s.pillText);
      const first = Number.isNaN(mem.x);
      const from = first ? (req.from ?? { x: innerWidth / 2, y: innerHeight / 2 }) : { x: mem.x, y: mem.y };
      wake(o);
      const pulse = () => {
        if (!req.pulse || reduced()) return;
        const ring = o.wrap.appendChild(document.createElement("div"));
        ring.className = "ring";
        ring.style.transform = `translate(${req.x}px, ${req.y}px)`;
        const a = ring.animate(
          [{ transform: `translate(${req.x}px, ${req.y}px) scale(0.3)`, opacity: 0.7 }, { transform: `translate(${req.x}px, ${req.y}px) scale(1)`, opacity: 0 }],
          { duration: s.pulseMs, easing: "ease-out" },
        );
        a.onfinish = () => ring.remove();
        setTimeout(() => ring.remove(), s.pulseMs + 200);
      };
      if (reduced() || req.ms <= 0 || typeof o.arrow.animate !== "function") {
        place(o, req.x, req.y);
        pulse();
        return;
      }
      place(o, from.x, from.y);
      return new Promise<void>((resolve) => {
        const a = o.arrow.animate(
          [{ transform: `translate(${from.x}px, ${from.y}px)` }, { transform: `translate(${req.x}px, ${req.y}px)` }],
          { duration: req.ms, easing: "ease-in-out", fill: "forwards" },
        );
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          place(o, req.x, req.y);
          a.cancel();
          pulse();
          resolve();
        };
        a.onfinish = finish;
        setTimeout(finish, req.ms + 150);  // a background tab may not run animations
      });
    }
  }
}

/** Never wait longer than this for the overlay (on top of a glide): it is decoration, not part of the command. */
const CALL_LIMIT_MS = 1000;

const lastPoint = new Map<number, Point>();

/** Test hook. */
export function resetCursorForTest(): void {
  lastPoint.clear();
}

async function send(tab: Target, req: CursorRequest, limit = CALL_LIMIT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const run = chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "ISOLATED", func: hermesCursor, args: [req, CURSOR_STYLE] });
    const late = new Promise<void>((resolve) => (timer = setTimeout(resolve, limit)));
    await Promise.race([run.then(() => undefined), late]);
    void run.catch(() => undefined);  // a call that lost the race must not become an unhandled rejection
  } catch {
    // purely cosmetic: a page where scripts cannot run, a closed tab, a navigation in flight
  } finally {
    clearTimeout(timer);
  }
}

/** Every method resolves, whatever the page does. */
export const cursor = {
  /** Glide to (x, y), then (optionally) pulse as a click would. Resolves when the arrow has arrived: send the real input after this. */
  async moveTo(tab: Target, x: number, y: number, opts: { pulse?: boolean } = {}): Promise<void> {
    const from = lastPoint.get(tab.id);
    const ms = glideMs(from ? Math.hypot(x - from.x, y - from.y) : undefined);
    lastPoint.set(tab.id, { x, y });
    await send(tab, { op: "move", x, y, from, ms, pulse: opts.pulse === true }, ms + CALL_LIMIT_MS);
  },
  /** Pill text: "Typing...", a key name (goes back to "Hermes" after a moment), "Waiting for approval". null puts the name back. */
  async say(tab: Target, text: string | null, opts: { ttl?: number } = {}): Promise<void> {
    await send(tab, { op: "say", text, ttl: opts.ttl });
  },
  /** A command is running: show the frame and the cursor, and restart the idle timer. */
  async busy(tab: Target): Promise<void> {
    await send(tab, { op: "busy" });
  },
  /** Hide the overlay while a screenshot is taken. */
  async hide(tab: Target): Promise<void> {
    await send(tab, { op: "hide" });
  },
  async show(tab: Target): Promise<void> {
    await send(tab, { op: "show" });
  },
  keyMs: CURSOR_STYLE.keyMs,
};
