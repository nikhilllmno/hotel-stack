import { describe, expect, it } from "vitest";
import { baseKey, classifyAction, classifyUrl, isSensitiveField, type ElementFacts } from "../src/background/risk";

const facts = (over: Partial<ElementFacts> = {}): ElementFacts => ({
  tag: "button",
  role: "button",
  name: "Search",
  inForm: false,
  pageHost: "example.com",
  ...over,
});

const click = { kind: "click" } as const;

describe("blocked", () => {
  it("never types into a password field, approved or not", () => {
    const pw = facts({ tag: "input", type: "password", role: "textbox", name: "Password", inForm: true, editable: true });
    for (const approved of [false, true]) {
      expect(classifyAction({ kind: "type" }, pw, approved).level).toBe("blocked");
    }
  });

  it("blocks card fields by autocomplete, name and id", () => {
    const base = { tag: "input", type: "text", role: "textbox", editable: true };
    expect(isSensitiveField(facts({ ...base, autocomplete: "cc-number" }))).toBe(true);
    expect(isSensitiveField(facts({ ...base, autocomplete: "section-pay cc-exp" }))).toBe(true);
    expect(isSensitiveField(facts({ ...base, fieldName: "card_number" }))).toBe(true);
    expect(isSensitiveField(facts({ ...base, fieldId: "cvv" }))).toBe(true);
    expect(isSensitiveField(facts({ ...base, fieldName: "Security Code" }))).toBe(true);
    expect(isSensitiveField(facts({ ...base, autocomplete: "one-time-code" }))).toBe(false);
    expect(isSensitiveField(facts({ ...base, fieldName: "guest_name" }))).toBe(false);
  });

  it("blocks text keys in a password field (also paste) but lets Tab and Escape through", () => {
    const pw = facts({ tag: "input", type: "password", role: "textbox", name: "Password", editable: true });
    expect(classifyAction({ kind: "press", key: "a" }, pw, false).level).toBe("blocked");
    expect(classifyAction({ kind: "press", key: "Control+V" }, pw, true).level).toBe("blocked");
    expect(classifyAction({ kind: "press", key: "+" }, pw, true).level).toBe("blocked");
    expect(classifyAction({ kind: "press", key: "Tab" }, pw, false).level).toBe("safe");
    expect(classifyAction({ kind: "click" }, pw, false).level).toBe("safe");
  });

  it("blocks javascript: and data: URLs", () => {
    expect(classifyUrl("javascript:alert(1)").level).toBe("blocked");
    expect(classifyUrl("  DATA:text/html,<b>x</b>").level).toBe("blocked");
    expect(classifyUrl("https://example.com/?next=javascript:x").level).toBe("safe");
  });
});

describe("needs_approval", () => {
  it("asks for submit controls", () => {
    expect(classifyAction(click, facts({ type: "submit" }), false)).toEqual({ level: "needs_approval", reason: "submits a form", name: "Search" });
    expect(classifyAction(click, facts({ tag: "input", type: "submit", role: "button" }), false).level).toBe("needs_approval");
    expect(classifyAction(click, facts({ tag: "input", type: "image", role: "button" }), false).level).toBe("needs_approval");
  });

  it("asks for a <button> in a form without a type, not outside a form or with type=button", () => {
    expect(classifyAction(click, facts({ inForm: true }), false).level).toBe("needs_approval");
    expect(classifyAction(click, facts({ inForm: false }), false).level).toBe("safe");
    expect(classifyAction(click, facts({ inForm: true, type: "button" }), false).level).toBe("safe");
  });

  it.each(["Pay now", "Book now", "Delete", "Place order", "Send", "Cancel booking", "Confirm", "Sign up", "Refund guest"])(
    "asks for a click on %s",
    (name) => {
      expect(classifyAction(click, facts({ tag: "a", role: "link", name }), false).level).toBe("needs_approval");
    },
  );

  it.each(["Search", "Bookings", "Next page", "Check-in", "Details", "Rooms"])("lets %s through", (name) => {
    expect(classifyAction(click, facts({ tag: "a", role: "link", name }), false).level).toBe("safe");
  });

  it("asks for Enter in a form field, not outside a form", () => {
    const field = facts({ tag: "input", type: "text", role: "textbox", name: "Guest", inForm: true, editable: true });
    expect(classifyAction({ kind: "press", key: "Enter" }, field, false)).toMatchObject({ level: "needs_approval", reason: "Enter submits the form" });
    expect(classifyAction({ kind: "press", key: "Shift+Enter" }, field, false).level).toBe("needs_approval");
    expect(classifyAction({ kind: "press", key: "Enter" }, { ...field, inForm: false }, false).level).toBe("safe");
    expect(classifyAction({ kind: "press", key: "Tab" }, field, false).level).toBe("safe");
  });

  it("asks for Enter on a risky button but not for arrow keys", () => {
    const del = facts({ name: "Delete reservation" });
    expect(classifyAction({ kind: "press", key: "Enter" }, del, false).level).toBe("needs_approval");
    expect(classifyAction({ kind: "press", key: "ArrowDown" }, del, false).level).toBe("safe");
  });

  it("asks for a select only inside a form and only for a risky name", () => {
    const select = facts({ tag: "select", role: "combobox", name: "Cancel reason", inForm: true });
    expect(classifyAction({ kind: "select" }, select, false).level).toBe("needs_approval");
    expect(classifyAction({ kind: "select" }, { ...select, inForm: false }, false).level).toBe("safe");
    expect(classifyAction({ kind: "select" }, { ...select, name: "Room type" }, false).level).toBe("safe");
  });

  it("lets typing, scrolling and hovering through on ordinary elements", () => {
    const field = facts({ tag: "input", type: "text", role: "textbox", name: "Send to", inForm: true, editable: true });
    for (const kind of ["type", "scroll", "hover"] as const) expect(classifyAction({ kind }, field, false).level).toBe("safe");
  });
});

describe("approved", () => {
  it("skips needs_approval", () => {
    expect(classifyAction(click, facts({ type: "submit" }), true)).toEqual({ level: "safe" });
    expect(classifyAction({ kind: "press", key: "Enter" }, facts({ name: "Pay" }), true)).toEqual({ level: "safe" });
  });
});

describe("baseKey", () => {
  it("takes the last part of a combo", () => {
    expect(baseKey("Control+A")).toBe("A");
    expect(baseKey("Enter")).toBe("Enter");
    expect(baseKey("+")).toBe("+");
    expect(baseKey("Control++")).toBe("+");
  });
});
