import { CommandError } from "./errors";

/** CDP Input.dispatchKeyEvent fields for one key press. */
export type KeyPress = {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  modifiers: number;
  text?: string;
  commands?: string[];
};

const MODIFIERS: Record<string, number> = { alt: 1, option: 1, control: 2, ctrl: 2, meta: 4, command: 4, cmd: 4, shift: 8 };

const NAMED: Record<string, { code: string; vk: number; text?: string }> = {
  enter: { code: "Enter", vk: 13, text: "\r" },
  tab: { code: "Tab", vk: 9 },
  escape: { code: "Escape", vk: 27 },
  esc: { code: "Escape", vk: 27 },
  backspace: { code: "Backspace", vk: 8 },
  delete: { code: "Delete", vk: 46 },
  space: { code: "Space", vk: 32, text: " " },
  arrowup: { code: "ArrowUp", vk: 38 },
  arrowdown: { code: "ArrowDown", vk: 40 },
  arrowleft: { code: "ArrowLeft", vk: 37 },
  arrowright: { code: "ArrowRight", vk: 39 },
  home: { code: "Home", vk: 36 },
  end: { code: "End", vk: 35 },
  pageup: { code: "PageUp", vk: 33 },
  pagedown: { code: "PageDown", vk: 34 },
};
const CANONICAL: Record<string, string> = { esc: "Escape", space: " " };

/** Editing shortcuts that Chrome only runs when the command is named in the event. */
const EDIT_COMMANDS: Record<string, string> = { a: "selectAll", c: "copy", v: "paste", x: "cut", z: "undo" };

/** "Enter", "Tab", "ArrowDown", "Control+A", "Shift+Tab", "a" -> the CDP key event. The returned `combo` is the canonical "Mod+Key" text the risk classifier reads. */
export function parseKey(combo: string): KeyPress & { combo: string } {
  const parts = combo === "+" || combo.endsWith("++") ? [...combo.slice(0, -1).split("+").filter(Boolean), "+"] : combo.split("+");
  const base = parts.pop() ?? "";
  let modifiers = 0;
  for (const m of parts) {
    const bit = MODIFIERS[m.toLowerCase()];
    if (!bit) throw new CommandError(`Unknown key modifier "${m}" in "${combo}". Use Control, Alt, Shift or Meta, for example Control+A.`);
    modifiers |= bit;
  }
  const named = NAMED[base.toLowerCase()];
  if (!named && base.length !== 1) {
    throw new CommandError(`Unknown key "${base}". Use a single character or Enter, Tab, Escape, Backspace, Delete, Space, Arrow keys, Home, End, PageUp, PageDown.`);
  }
  const key = named ? (CANONICAL[base.toLowerCase()] ?? named.code) : base;
  const shortcut = (modifiers & 6) !== 0; // Control or Meta
  const text = named ? named.text : shortcut || (modifiers & 1) ? undefined : base;
  const letter = /^[a-z]$/i.test(base);
  const press: KeyPress = {
    key,
    code: named ? named.code : letter ? `Key${base.toUpperCase()}` : /^\d$/.test(base) ? `Digit${base}` : "",
    windowsVirtualKeyCode: named ? named.vk : base.toUpperCase().charCodeAt(0),
    modifiers,
    text,
  };
  if (shortcut && !named && EDIT_COMMANDS[base.toLowerCase()]) press.commands = [EDIT_COMMANDS[base.toLowerCase()]];
  return { ...press, combo: [...parts, key].join("+") };
}
