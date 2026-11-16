import { describe, expect, it } from "vitest";
import { formatSnapshot } from "../src/background/commands/snapshot";
import type { SnapshotData, SnapshotElement } from "../src/background/page";
import type { ElementFacts } from "../src/background/risk";

const facts = (over: Partial<ElementFacts>): ElementFacts => ({ tag: "button", role: "button", name: "", inForm: false, pageHost: "x.com", ...over });
const el = (ref: string, f: Partial<ElementFacts>, over: Partial<SnapshotElement> = {}): SnapshotElement => ({
  ref,
  facts: facts(f),
  disabled: false,
  checked: false,
  ...over,
});
const data = (elements: SnapshotElement[], over: Partial<SnapshotData> = {}): SnapshotData => ({
  url: "https://x.com/a",
  title: "Title",
  scrollX: 0,
  scrollY: 100,
  pageHeight: 3000,
  viewport: { width: 1280, height: 800 },
  iframes: 0,
  total: elements.length,
  elements,
  text: "Hello",
  textLeft: 0,
  ...over,
});

describe("formatSnapshot", () => {
  it("writes the compact element lines", () => {
    const out = formatSnapshot(
      data([
        el("e1", { role: "link", name: "Bookings" }, { href: "/bookings" }),
        el("e2", { tag: "input", role: "textbox", name: "Check-in", inForm: true }, { value: "2026-11-20" }),
        el("e3", { name: "Search" }, { disabled: true }),
        el("e4", { role: "checkbox", name: "Breakfast" }, { checked: true }),
      ]),
    );
    expect(out).toContain('[e1] link "Bookings" -> /bookings');
    expect(out).toContain('[e2] textbox "Check-in" value="2026-11-20" (in form)');
    expect(out).toContain('[e3] button "Search" (disabled)');
    expect(out).toContain('[e4] checkbox "Breakfast" (checked)');
    expect(out).toContain("Page: \"Title\"\nURL: https://x.com/a\nScroll: 100 of 3000 px down (viewport 1280x800)");
    expect(out).toContain("Visible text:\nHello");
  });

  it("never shows the value of a password or card field", () => {
    const out = formatSnapshot(
      data([
        el("e1", { tag: "input", type: "password", role: "textbox", name: "Password" }, { value: "hunter2" }),
        el("e2", { tag: "input", role: "textbox", name: "Card", autocomplete: "cc-number" }, { value: "4111" }),
      ]),
    );
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("4111");
    expect(out).toContain("Hermes never types here");
  });

  it("notes iframes, capped lists and cut text", () => {
    const out = formatSnapshot(data([el("e1", { name: "A" })], { iframes: 2, total: 900, textLeft: 55 }));
    expect(out).toContain("content of 2 iframe(s) is not included");
    expect(out).toContain("Only the first 1 of 900 elements are listed.");
    expect(out).toContain("55 more characters");
  });

  it("handles an empty page", () => {
    expect(formatSnapshot(data([], { text: "" }))).toContain("(no interactive elements)");
  });
});
