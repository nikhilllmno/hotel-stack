import { describe, expect, it } from "vitest";
import { baseKey, classifyAction, classifyTargets, classifyUrl, isSensitiveField, type ElementFacts } from "../src/background/risk";

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
    expect(isSensitiveField(facts({ ...base, autocomplete: "cc-exp-month" }))).toBe(true);
    expect(isSensitiveField(facts({ ...base, autocomplete: "cc-csc" }))).toBe(true);
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

  it("blocks one-time-code fields: typing, pasting and picking, approved or not", () => {
    const otp = facts({ tag: "input", type: "text", role: "textbox", name: "Code", editable: true, autocomplete: "one-time-code" });
    expect(isSensitiveField(otp)).toBe(true);
    expect(isSensitiveField(facts({ ...otp, autocomplete: "section-login one-time-code" }))).toBe(true);
    for (const approved of [false, true]) {
      expect(classifyAction({ kind: "type" }, otp, approved).level).toBe("blocked");
      expect(classifyAction({ kind: "press", key: "5" }, otp, approved).level).toBe("blocked");
      expect(classifyAction({ kind: "press", key: "Meta+v" }, otp, approved).level).toBe("blocked");
    }
  });

  it("blocks every value change on a card field, not only typing", () => {
    const exp = facts({ tag: "select", role: "combobox", name: "Month", autocomplete: "cc-exp-month", inForm: true });
    for (const approved of [false, true]) {
      expect(classifyAction({ kind: "select" }, exp, approved).level).toBe("blocked");
      expect(classifyAction({ kind: "type" }, exp, approved).level).toBe("blocked");
    }
    // An option takes the facts of its dropdown, so clicking one is a value change too.
    const option = { ...exp, tag: "div", role: "option", name: "07" };
    expect(classifyAction(click, option, true).level).toBe("blocked");
    expect(classifyAction({ kind: "press", key: "Backspace" }, exp, true).level).toBe("blocked");
    expect(classifyAction({ kind: "press", key: "Delete" }, exp, true).level).toBe("blocked");
    expect(classifyAction({ kind: "press", key: "Space" }, exp, true).level).toBe("blocked");
    expect(classifyAction({ kind: "press", key: "Control+x" }, exp, true).level).toBe("blocked");
    expect(classifyAction({ kind: "press", key: "Control+a" }, exp, true).level).not.toBe("blocked");
    expect(classifyAction({ kind: "press", key: "Tab" }, exp, true).level).toBe("safe");
    expect(classifyAction(click, exp, true).level).toBe("safe");
  });

  it("blocks activating a javascript:, data: or vbscript: link, form action or formaction", () => {
    for (const activationUrl of ["javascript:fetch('/del')", "JaVaScRiPt:void(0)", "data:text/html,x", "vbscript:msgbox(1)", " java\tscript:alert(1)"]) {
      const link = facts({ tag: "a", role: "link", name: "Home", activationUrl });
      for (const approved of [false, true]) {
        expect(classifyAction(click, link, approved).level).toBe("blocked");
        expect(classifyAction({ kind: "press", key: "Enter" }, link, approved).level).toBe("blocked");
      }
    }
    expect(classifyAction(click, facts({ tag: "a", role: "link", name: "Home", activationUrl: "https://example.com/home" }), false).level).toBe("safe");
    // hovering never activates
    expect(classifyAction({ kind: "hover" }, facts({ activationUrl: "javascript:x" }), false).level).toBe("safe");
  });

  it("blocks javascript:, data: and vbscript: URLs", () => {
    expect(classifyUrl("vbscript:msgbox(1)").level).toBe("blocked");
    expect(classifyUrl("javascript:alert(1)").level).toBe("blocked");
    expect(classifyUrl("  DATA:text/html,<b>x</b>").level).toBe("blocked");
    expect(classifyUrl("https://example.com/?next=javascript:x").level).toBe("safe");
  });
});

describe("blocked: recipients Hermes cannot inspect", () => {
  it.each(["iframe", "frame", "embed", "object"])("blocks typing, keys and select on <%s>, approved or not", (tag) => {
    const frame = facts({ tag, role: "clickable", name: "Checkout" });
    for (const approved of [false, true]) {
      for (const action of [{ kind: "type" }, { kind: "select" }, { kind: "press", key: "a" }, { kind: "press", key: "Enter" }, { kind: "press", key: "ArrowDown" }, { kind: "press", key: "Tab" }] as const) {
        expect(classifyAction(action, frame, approved).level).toBe("blocked");
      }
    }
  });
});

describe("one value-change policy", () => {
  const select = facts({ tag: "select", role: "combobox", name: "Room type", inForm: true });
  const VALUE_KEYS = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Space", " ", "k", "5"];

  it.each(VALUE_KEYS)("a %s press on a form select asks, as the select action does", (key) => {
    expect(classifyAction({ kind: "select" }, select, false).level).toBe("needs_approval");
    expect(classifyAction({ kind: "press", key }, select, false)).toMatchObject({ level: "needs_approval", reason: "changes a form field" });
  });

  it.each(VALUE_KEYS)("a %s press on a card-expiry select is blocked, as the select action is", (key) => {
    const month = { ...select, name: "Month", autocomplete: "cc-exp-month" };
    expect(classifyAction({ kind: "select" }, month, true).level).toBe("blocked");
    expect(classifyAction({ kind: "press", key }, month, true).level).toBe("blocked");
  });

  it("covers listbox, radio, checkbox, range and spinbutton keys, and option clicks", () => {
    const controls = [
      facts({ tag: "div", role: "listbox", inForm: true }),
      facts({ tag: "input", type: "radio", role: "radio", inForm: true }),
      facts({ tag: "input", type: "checkbox", role: "checkbox", inForm: true }),
      facts({ tag: "input", type: "range", role: "slider", inForm: true }),
      facts({ tag: "div", role: "spinbutton", inForm: true }),
    ];
    for (const c of controls) {
      expect(classifyAction({ kind: "press", key: "ArrowRight" }, c, false).level).toBe("needs_approval");
      expect(classifyAction({ kind: "press", key: "ArrowRight" }, { ...c, inForm: false }, false).level).toBe("safe");
      expect(classifyAction({ kind: "press", key: "ArrowRight" }, { ...c, autocomplete: "cc-exp-year" }, false).level).toBe("blocked");
    }
    const option = facts({ tag: "div", role: "option", name: "Twin", inForm: true });
    expect(classifyAction(click, option, false).level).toBe("needs_approval");
    expect(classifyAction(click, { ...option, search: true }, false).level).toBe("safe");
    expect(classifyAction(click, { ...option, autocomplete: "cc-exp-month" }, false).level).toBe("blocked");
  });

  it("leaves Tab and Escape alone, and keys typed into a text field stay typing", () => {
    for (const key of ["Tab", "Escape", "Shift+Tab", "Control+A"]) expect(classifyAction({ kind: "press", key }, select, false).level).toBe("safe");
    const text = facts({ tag: "input", type: "text", role: "textbox", name: "Guest", inForm: true, editable: true });
    for (const key of ["a", "Space", "ArrowLeft", "Backspace"]) expect(classifyAction({ kind: "press", key }, text, false).level).toBe("safe");
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

  it("asks for Enter in any editable field except a search box", () => {
    const field = facts({ tag: "input", type: "text", role: "textbox", name: "Guest", inForm: true, editable: true });
    expect(classifyAction({ kind: "press", key: "Enter" }, field, false)).toMatchObject({ level: "needs_approval" });
    // A field outside a form can still submit through script, so Enter is not free there either.
    expect(classifyAction({ kind: "press", key: "Enter" }, { ...field, inForm: false }, false).level).toBe("needs_approval");
    expect(classifyAction({ kind: "press", key: "Enter" }, { ...field, tag: "div", role: "textbox", type: undefined }, false).level).toBe("needs_approval");
    expect(classifyAction({ kind: "press", key: "Enter" }, { ...field, type: "search", search: true }, false).level).toBe("safe");
    expect(classifyAction({ kind: "press", key: "Tab" }, field, false).level).toBe("safe");
    expect(classifyAction({ kind: "press", key: "Space" }, field, false).level).toBe("safe");
    expect(classifyAction({ kind: "press", key: "a" }, field, false).level).toBe("safe");
  });

  it.each(["Control+Enter", "Meta+Enter", "Shift+Enter", "Alt+Enter"])("asks for %s anywhere, even in a search box or on a plain element", (key) => {
    const search = facts({ tag: "input", type: "search", role: "textbox", name: "Search", editable: true, search: true });
    expect(classifyAction({ kind: "press", key }, search, false).level).toBe("needs_approval");
    expect(classifyAction({ kind: "press", key }, facts({ tag: "div", role: "clickable", name: "x" }), false).level).toBe("needs_approval");
    expect(classifyAction({ kind: "press", key }, facts({ tag: "body", role: "clickable", name: "" }), false).level).toBe("needs_approval");
  });

  it("asks for Enter on a risky button but not for arrow keys", () => {
    const del = facts({ name: "Delete reservation" });
    expect(classifyAction({ kind: "press", key: "Enter" }, del, false).level).toBe("needs_approval");
    expect(classifyAction({ kind: "press", key: "ArrowDown" }, del, false).level).toBe("safe");
  });

  it("asks for a select inside a form, whatever its name, but not outside one or in a search form", () => {
    const select = facts({ tag: "select", role: "combobox", name: "Room type", inForm: true });
    expect(classifyAction({ kind: "select" }, select, false).level).toBe("needs_approval");
    expect(classifyAction({ kind: "select" }, { ...select, name: "Cancel reason" }, false).level).toBe("needs_approval");
    expect(classifyAction({ kind: "select" }, { ...select, inForm: false }, false).level).toBe("safe");
    expect(classifyAction({ kind: "select" }, { ...select, search: true }, false).level).toBe("safe");
  });

  it("reads the visible text even when aria-label says something harmless", () => {
    const disguised = facts({ tag: "a", role: "link", name: "Continue", ariaLabel: "Continue", text: "Delete account" });
    expect(classifyAction(click, disguised, false)).toMatchObject({ level: "needs_approval", reason: "risky wording" });
    expect(classifyAction(click, facts({ tag: "a", role: "link", name: "Rooms", text: "Rooms", ariaLabel: "Rooms" }), false).level).toBe("safe");
  });

  it("reads aria-label, title and a button's value too", () => {
    expect(classifyAction(click, facts({ tag: "a", role: "link", name: "Go", text: "Go", title: "Pay the invoice" }), false).level).toBe("needs_approval");
    expect(classifyAction(click, facts({ tag: "a", role: "link", name: "Go", text: "Go", ariaLabel: "Publish" }), false).level).toBe("needs_approval");
    expect(classifyAction(click, facts({ tag: "input", type: "button", role: "button", name: "Go", value: "Refund" }), false).level).toBe("needs_approval");
  });

  it.each(["Save", "Update profile", "Apply", "Done", "Finish", "Accept", "Allow", "Grant access", "Proceed", "Continue to checkout", "Continue to payment"])(
    "asks for a click on %s",
    (name) => {
      expect(classifyAction(click, facts({ tag: "button", role: "button", name, type: "button" }), false).level).toBe("needs_approval");
    },
  );

  it.each(["Continue", "Applications", "Saved searches", "Updates feed"])("does not trip on %s", (name) => {
    expect(classifyAction(click, facts({ tag: "a", role: "link", name }), false).level).toBe("safe");
  });

  it("asks before a click on a frame it cannot read", () => {
    const frame = facts({ tag: "iframe", role: "clickable", name: "" });
    expect(classifyAction(click, frame, false).level).toBe("needs_approval");
    expect(classifyAction({ kind: "hover" }, frame, false).level).toBe("safe");
    expect(classifyAction({ kind: "scroll" }, frame, false).level).toBe("safe");
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

describe("classifyTargets", () => {
  it("takes the strictest verdict of every element that may get the click", () => {
    const wrapper = facts({ tag: "div", role: "button", name: "Open" });
    const submit = facts({ type: "submit", name: "Open" });
    expect(classifyTargets(click, [wrapper], false).level).toBe("safe");
    expect(classifyTargets(click, [wrapper, submit], false).level).toBe("needs_approval");
    expect(classifyTargets(click, [wrapper, facts({ tag: "a", role: "link", activationUrl: "javascript:x" }), submit], true).level).toBe("blocked");
    expect(classifyTargets(click, [], false).level).toBe("safe");
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
