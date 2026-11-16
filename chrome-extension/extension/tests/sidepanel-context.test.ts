import { describe, expect, it } from "vitest";
import { chatTitle, contextLine, stripContext, withContext } from "../src/lib/context";

const tab = { title: "Bookings - Beds24", url: "https://beds24.com/control3.php" };

describe("message context prefix", () => {
  it("has the exact line the agent reads", () => {
    expect(contextLine(tab)).toBe('[From the Hermes Chrome extension. Current tab: "Bookings - Beds24" https://beds24.com/control3.php. Use the chrome tools to act in this browser.]');
  });

  it("goes in front of the message, separated by a blank line", () => {
    expect(withContext("hello", tab)).toBe(`${contextLine(tab)}\n\nhello`);
  });

  it("is left out when the owner dropped the chip", () => {
    expect(withContext("hello", null)).toBe("hello");
  });

  it("keeps a odd title on one line", () => {
    expect(contextLine({ title: 'He said "hi"\nbye', url: "https://x.y" })).toContain('"He said \'hi\' bye" https://x.y');
  });

  it("is hidden when showing the message", () => {
    expect(stripContext(withContext("hello\nworld", tab))).toBe("hello\nworld");
    expect(stripContext("plain")).toBe("plain");
    expect(stripContext("[not ours] hi")).toBe("[not ours] hi");
  });
});

describe("chatTitle", () => {
  it("is 'Chrome: ' + the first 40 characters", () => {
    expect(chatTitle("Summarise this page")).toBe("Chrome: Summarise this page");
    expect(chatTitle("x".repeat(100))).toBe(`Chrome: ${"x".repeat(40)}`);
    expect(chatTitle("  a\n b ")).toBe("Chrome: a b");
  });
});
