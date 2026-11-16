import { describe, expect, it } from "vitest";
import { parseKey } from "../src/background/keys";

describe("parseKey", () => {
  it("maps Enter to a keyDown with text so forms submit", () => {
    expect(parseKey("Enter")).toMatchObject({ key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", modifiers: 0, combo: "Enter" });
  });

  it("accepts any case and aliases and canonicalises the combo", () => {
    expect(parseKey("esc").combo).toBe("Escape");
    expect(parseKey("arrowdown")).toMatchObject({ key: "ArrowDown", windowsVirtualKeyCode: 40, text: undefined });
    expect(parseKey("Space")).toMatchObject({ key: " ", text: " " });
  });

  it("sets modifiers and editing commands for shortcuts", () => {
    const press = parseKey("Control+A");
    expect(press).toMatchObject({ key: "a".toUpperCase(), code: "KeyA", modifiers: 2, text: undefined, commands: ["selectAll"], combo: "Control+A" });
    expect(parseKey("Shift+Tab")).toMatchObject({ modifiers: 8, key: "Tab" });
  });

  it("types single characters, including a lone +", () => {
    expect(parseKey("x")).toMatchObject({ key: "x", code: "KeyX", text: "x" });
    expect(parseKey("7")).toMatchObject({ code: "Digit7", text: "7" });
    expect(parseKey("+")).toMatchObject({ key: "+", combo: "+" });
  });

  it("explains unknown keys and modifiers", () => {
    expect(() => parseKey("Hyper+A")).toThrow(/Unknown key modifier "Hyper"/);
    expect(() => parseKey("Foo")).toThrow(/Unknown key "Foo"/);
  });
});
