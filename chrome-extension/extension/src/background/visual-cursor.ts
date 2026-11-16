import type { Target } from "./debugger";

type CursorState = { host: HTMLDivElement; pulse: HTMLDivElement; hideTimer?: number };
type CursorWindow = typeof globalThis & { __hermesVisualCursor?: CursorState };

const DURATION_MS = 180;
const HIDE_AFTER_MS = 650;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A visible, non-interactive cursor for actions Hermes performs through CDP.
 * CDP cannot move the owner's physical pointer; this makes the agent's path and
 * click location legible without participating in hit testing.
 */
async function drawCursor({ x, y, click }: { x: number; y: number; click: boolean }): Promise<void> {
  const state = globalThis as CursorWindow;
  let cursor = state.__hermesVisualCursor;
  let isNew = false;

  if (!cursor || !cursor.host.isConnected) {
    isNew = true;
    const host = document.createElement("div");
    host.setAttribute("data-hermes-visual-cursor", "");
    host.setAttribute("aria-hidden", "true");
    Object.assign(host.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "30px",
      height: "38px",
      zIndex: "2147483647",
      pointerEvents: "none",
      userSelect: "none",
      opacity: "0",
      transform: `translate3d(${Math.max(16, Math.round(window.innerWidth / 2))}px, ${Math.max(16, Math.round(window.innerHeight / 2))}px, 0)`,
      willChange: "transform, opacity",
    });

    const arrow = document.createElement("div");
    arrow.style.cssText = "position:absolute;inset:0;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));";
    arrow.innerHTML = '<svg viewBox="0 0 24 30" width="24" height="30" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 2.5 3.8 25l6-6.2 4.2 8.2 4.2-2.1-4.1-8.1 8.5-.9L3 2.5Z" fill="#171717" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>';

    const pulse = document.createElement("div");
    pulse.style.cssText = "position:absolute;left:1px;top:1px;width:20px;height:20px;border:2px solid #2563eb;border-radius:999px;opacity:0;pointer-events:none;";
    host.append(arrow, pulse);
    document.documentElement.append(host);
    cursor = { host, pulse };
    state.__hermesVisualCursor = cursor;
  }

  if (cursor.hideTimer !== undefined) clearTimeout(cursor.hideTimer);
  // Let the initial position paint before transitioning to the target.
  await nextFrame();
  if (isNew) await nextFrame();

  cursor.host.style.transition = `transform ${DURATION_MS}ms cubic-bezier(.2,.8,.2,1), opacity 120ms ease-out`;
  cursor.host.style.opacity = "1";
  cursor.host.style.transform = `translate3d(${Math.round(x - 3)}px, ${Math.round(y - 3)}px, 0)`;
  await sleep(DURATION_MS);

  if (click) {
    cursor.pulse.animate(
      [
        { transform: "scale(.25)", opacity: 0.95 },
        { transform: "scale(1.75)", opacity: 0 },
      ],
      { duration: 240, easing: "ease-out" },
    );
  }

  cursor.hideTimer = window.setTimeout(() => {
    cursor!.host.style.opacity = "0";
  }, HIDE_AFTER_MS);
}

/** Show the agent's pointer before a CDP mouse action. Visual feedback must never block the action itself. */
export async function showCursor(tab: Target, x: number, y: number, click = false): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      func: drawCursor,
      args: [{ x, y, click }],
    });
  } catch {
    // The CDP action remains authoritative; e.g. a page can disappear between locating and drawing.
  }
}
