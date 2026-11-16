import { cdp, type Target } from "./debugger";
import { parseKey, type KeyPress } from "./keys";

/** Trusted input through CDP: the page sees real mouse and keyboard events, not synthetic DOM events. */

export async function mouseMove(tab: Target, x: number, y: number): Promise<void> {
  await cdp(tab, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}

export async function mouseClick(tab: Target, x: number, y: number): Promise<void> {
  await mouseMove(tab, x, y);
  await cdp(tab, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await cdp(tab, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

export async function wheel(tab: Target, x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
  await cdp(tab, "Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX, deltaY });
}

export async function insertText(tab: Target, text: string): Promise<void> {
  await cdp(tab, "Input.insertText", { text });
}

export async function pressKey(tab: Target, combo: string): Promise<void> {
  await sendKey(tab, parseKey(combo));
}

async function sendKey(tab: Target, { key, code, windowsVirtualKeyCode, modifiers, text, commands }: KeyPress): Promise<void> {
  const event = { key, code, windowsVirtualKeyCode, modifiers };
  await cdp(tab, "Input.dispatchKeyEvent", { ...event, type: text ? "keyDown" : "rawKeyDown", text, commands });
  await cdp(tab, "Input.dispatchKeyEvent", { ...event, type: "keyUp" });
}

/** The visible part of the page in CSS pixels (page coordinates of its corner and its size). */
export async function visualViewport(tab: Target): Promise<{ pageX: number; pageY: number; clientWidth: number; clientHeight: number }> {
  return (await cdp<{ cssVisualViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number } }>(tab, "Page.getLayoutMetrics")).cssVisualViewport;
}
