import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { hermesPage, type PageRequest, type SnapshotData } from "../src/background/page";

/** jsdom has no layout: give every element a box (except display:none) and an innerText. */
beforeAll(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const hidden = this.closest("[style*=\"display:none\"]") !== null;
    return { left: 0, top: 0, right: hidden ? 0 : 100, bottom: hidden ? 0 : 20, width: hidden ? 0 : 100, height: hidden ? 0 : 20, x: 0, y: 0, toJSON: () => ({}) };
  });
  Object.defineProperty(HTMLElement.prototype, "innerText", { configurable: true, get() { return this.textContent; } });
  Element.prototype.scrollIntoView = () => undefined;
  document.elementFromPoint = (() => document.body) as typeof document.elementFromPoint;
});

afterEach(() => {
  document.body.innerHTML = "";
  (globalThis as { __hermesRefs?: Map<string, Element> }).__hermesRefs = undefined;
});

const run = <T>(req: PageRequest) => hermesPage(req) as T;
const snapshot = () => run<SnapshotData>({ op: "snapshot", maxText: 6000 });

describe("snapshot", () => {
  it("lists interactive elements in reading order with refs, names, values and state", () => {
    document.title = "Rates";
    document.body.innerHTML = `
      <a href="/bookings">Bookings</a>
      <form action="/save"><label for="ci">Check-in</label><input id="ci" value="2026-11-20">
        <input type="checkbox" aria-label="Breakfast" checked><button>Go</button><button disabled>Wait</button></form>
      <div role="tab">Overview</div><span style="display:none"><a href="/x">hidden</a></span>`;
    const d = snapshot();
    expect(d.title).toBe("Rates");
    expect(d.elements.map((e) => [e.ref, e.facts.role, e.facts.name])).toEqual([
      ["e1", "link", "Bookings"],
      ["e2", "textbox", "Check-in"],
      ["e3", "checkbox", "Breakfast"],
      ["e4", "button", "Go"],
      ["e5", "button", "Wait"],
      ["e6", "tab", "Overview"],
    ]);
    expect(d.elements[0].href).toBe("/bookings");
    expect(d.elements[1]).toMatchObject({ value: "2026-11-20" });
    expect(d.elements[1].facts.inForm).toBe(true);
    expect(d.elements[2].checked).toBe(true);
    expect(d.elements[4].disabled).toBe(true);
  });

  it("replaces the refs on every snapshot", () => {
    document.body.innerHTML = `<button>A</button>`;
    snapshot();
    document.body.innerHTML = `<button>B</button><button>C</button>`;
    snapshot();
    expect(run({ op: "locate", ref: "e2" })).toMatchObject({ found: true, facts: { name: "C" } });
  });

  it("trims the visible text to max_text and reports what was cut", () => {
    document.body.innerHTML = `<p>${"x".repeat(100)}</p>`;
    const d = run<SnapshotData>({ op: "snapshot", maxText: 30 });
    expect(d.text).toHaveLength(30);
    expect(d.textLeft).toBe(70);
  });

  it("counts iframes", () => {
    document.body.innerHTML = `<iframe></iframe><iframe></iframe>`;
    expect(snapshot().iframes).toBe(2);
  });
});

describe("element facts", () => {
  it("gathers what the risk classifier needs", () => {
    document.body.innerHTML = `<form action="/pay"><input id="c" name="card_number" autocomplete="cc-number"><button type="submit">Pay</button><button>Plain</button></form>`;
    const [input, submit, plain] = snapshot().elements.map((e) => e.facts);
    expect(input).toMatchObject({ tag: "input", type: "text", fieldName: "card_number", fieldId: "c", autocomplete: "cc-number", inForm: true, formAction: "/pay", editable: true });
    expect(submit).toMatchObject({ tag: "button", type: "submit", role: "button", name: "Pay" });
    expect(plain.type).toBeUndefined();
    expect(submit.pageHost).toBe(location.hostname);
  });

  it("reports the focused element for press", () => {
    document.body.innerHTML = `<input id="a" type="password">`;
    (document.getElementById("a") as HTMLInputElement).focus();
    expect(run({ op: "active" })).toMatchObject({ tag: "input", type: "password" });
  });
});

describe("locate / focus / select", () => {
  it("answers 'gone' for an unknown or detached ref", () => {
    document.body.innerHTML = `<button>A</button>`;
    snapshot();
    expect(run({ op: "locate", ref: "e9" })).toEqual({ found: false, reason: "gone" });
    document.body.innerHTML = "";
    expect(run({ op: "locate", ref: "e1" })).toEqual({ found: false, reason: "gone" });
  });

  it("finds the centre of an element and flags a covering element", () => {
    document.body.innerHTML = `<button id="b">A</button><div id="overlay">Accept cookies</div>`;
    snapshot();
    document.elementFromPoint = () => document.getElementById("b");
    expect(run({ op: "locate", ref: "e1" })).toMatchObject({ found: true, x: 50, y: 10, covered: undefined });
    document.elementFromPoint = () => document.getElementById("overlay");
    expect(run({ op: "locate", ref: "e1" })).toMatchObject({ found: true, covered: "Accept cookies" });
  });

  it("selects a native option by label, case-insensitively, and fires change", () => {
    document.body.innerHTML = `<select aria-label="Room"><option value="s">Standard</option><option value="d">Deluxe</option></select>`;
    snapshot();
    const select = document.querySelector("select") as HTMLSelectElement;
    const onChange = vi.fn();
    select.addEventListener("change", onChange);
    expect(run({ op: "select", ref: "e1", text: "deluxe" })).toMatchObject({ native: true, label: "Deluxe" });
    expect(select.value).toBe("d");
    expect(onChange).toHaveBeenCalledOnce();
    const miss = run<{ label?: string; options: string[] }>({ op: "select", ref: "e1", text: "suite" });
    expect(miss.label).toBeUndefined();
    expect(miss.options).toEqual(["Standard", "Deluxe"]);
  });

  it("says when the element is not a native dropdown", () => {
    document.body.innerHTML = `<div role="combobox">Pick</div>`;
    snapshot();
    expect(run({ op: "select", ref: "e1", text: "x" })).toMatchObject({ found: true, native: false });
  });

  it("focus reports whether the field had text", () => {
    document.body.innerHTML = `<input value="old"><input>`;
    snapshot();
    expect(run({ op: "focus", ref: "e1", clear: true })).toEqual({ found: true, hadText: true });
    expect(document.activeElement).toBe(document.querySelector("input"));
    expect(run({ op: "focus", ref: "e2", clear: true })).toEqual({ found: true, hadText: false });
  });
});
