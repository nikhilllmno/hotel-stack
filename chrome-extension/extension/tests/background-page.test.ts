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
  (globalThis as { __hermes?: unknown }).__hermes = undefined;
  document.elementFromPoint = (() => document.body) as typeof document.elementFromPoint;
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
    expect(run({ op: "active" })).toMatchObject({ facts: { tag: "input", type: "password" } });
  });

  it("collects visible text, aria-label, title, button value, method and activation URL separately", () => {
    document.body.innerHTML =
      `<form action="/search" method="POST"><a id="l" href="/rooms?x=1" aria-label="Continue" title="Info">Delete account</a>` +
      `<input id="b" type="submit" value="Refund" formaction="javascript:go()"></form>`;
    const [link, btn] = snapshot().elements.map((e) => e.facts);
    expect(link).toMatchObject({ name: "Continue", text: "Delete account", ariaLabel: "Continue", title: "Info", formMethod: "post", activationUrl: `${location.origin}/rooms?x=1` });
    expect(btn).toMatchObject({ value: "Refund", activationUrl: "javascript:go()" });
  });

  it("uses the form action as the activation URL of a submit button, resolved against the page", () => {
    document.body.innerHTML = `<form action="javascript:evil()"><button type="submit">Go</button></form><form action="/ok"><button type="submit">Ok</button></form>`;
    const [bad, ok] = snapshot().elements.map((e) => e.facts);
    expect(bad.activationUrl).toBe("javascript:evil()");
    expect(ok.activationUrl).toBe(`${location.origin}/ok`);
  });

  it("marks search boxes: type=search, inside role=search, a GET form with a q field; not a POST or password form", () => {
    document.body.innerHTML =
      `<input type="search" id="s1"><div role="search"><input id="s2"></div>` +
      `<form action="/s"><input name="q" id="s3"></form><form method="post"><input name="q" id="s4"></form>` +
      `<form action="/s"><input name="q" id="s5"><input type="password"></form><form><input name="guest" id="s6"></form>`;
    const byId = Object.fromEntries(snapshot().elements.map((e) => [e.facts.fieldId, e.facts.search]));
    expect(byId).toMatchObject({ s1: true, s2: true, s3: true, s4: false, s5: false, s6: false });
  });

  it("a search exception needs a form that only reads: Enter in any POST form (or with a POST submitter) is not a search", () => {
    document.body.innerHTML =
      // marked as search, but the form posts
      `<form method="post"><input type="search" id="p1"></form>` +
      `<form method="POST"><div role="search"><input id="p2"></div></form>` +
      `<div role="search"><form method="post"><input name="q" id="p3"></form></div>` +
      // a GET form whose submit button overrides the method
      `<form><input type="search" id="p4"><button formmethod="post">Go</button></form>` +
      // the field is outside the <form> tag but belongs to a POST form through the form attribute
      `<form id="pf" method="post"></form><input type="search" id="p5" form="pf">` +
      // genuine searches
      `<form method="get"><input type="search" id="g1"></form><form><div role="search"><input id="g2"></div></form>` +
      `<form><input name="q" id="g3"><button formmethod="get">Go</button></form><input type="search" id="g4">`;
    const byId = Object.fromEntries(snapshot().elements.map((e) => [e.facts.fieldId, e.facts.search]));
    expect(byId).toMatchObject({ p1: false, p2: false, p3: false, p4: false, p5: false, g1: true, g2: true, g3: true, g4: true });
  });

  it("a submitter that overrides the method makes the field no search: <input type=image>, and controls tied to the form by form=", () => {
    document.body.innerHTML =
      // <input type=image> is not in form.elements
      `<form><input type="search" id="i1"><input type="image" src="x.png" formmethod="post"></form>` +
      `<form><input type="search" id="i2"><input type="submit" formmethod="post" value="Go"></form>` +
      // submitters outside the tag, tied to the form by id
      `<form id="f3"><input type="search" id="i3"></form><button form="f3" formmethod="post">Go</button>` +
      `<form id="f4"><input type="search" id="i4"></form><input type="image" form="f4" formmethod="POST" src="x.png">` +
      // a button that does not submit, or a GET override, does not change anything
      `<form><input type="search" id="k1"><button type="button" formmethod="post">x</button></form>` +
      `<form id="f5"><input type="search" id="k2"></form><button form="f5" formmethod="get">Go</button>` +
      `<form id="f6"><input type="search" id="k3"></form><button form="other" formmethod="post">Go</button>`;
    const byId = Object.fromEntries(snapshot().elements.map((e) => [e.facts.fieldId, e.facts.search]));
    expect(byId).toMatchObject({ i1: false, i2: false, i3: false, i4: false, k1: true, k2: true, k3: true });
  });

  it("gives an option the autocomplete, name and id of its dropdown", () => {
    document.body.innerHTML = `<div role="listbox" id="m" aria-label="Month"><div role="option" id="o">07</div></div>`;
    document.getElementById("m")!.setAttribute("autocomplete", "cc-exp-month");
    const option = snapshot().elements.find((e) => e.facts.role === "option")!;
    expect(option.facts).toMatchObject({ autocomplete: "cc-exp-month", fieldId: "m" });
  });

  it("identifies the document with a stable nonce and a generation that grows with each snapshot", () => {
    document.body.innerHTML = `<button>A</button>`;
    snapshot();
    const first = run<{ doc: { nonce: string; generation: number; href: string } }>({ op: "locate", ref: "e1" }).doc;
    expect(first.nonce).toMatch(/^[0-9a-f]{24}$/);
    expect(run<{ doc: typeof first }>({ op: "active" }).doc).toEqual(first);
    snapshot();
    const second = run<{ doc: typeof first }>({ op: "locate", ref: "e1" }).doc;
    expect(second).toEqual({ nonce: first.nonce, generation: first.generation + 1, href: first.href });
  });

  it("puts location.href in the document id, so a same-document route change is visible", () => {
    document.body.innerHTML = `<button>A</button>`;
    snapshot();
    const before = run<{ doc: { nonce: string; href: string } }>({ op: "locate", ref: "e1" }).doc;
    history.pushState({}, "", "/rooms/7#edit");
    const after = run<{ doc: { nonce: string; href: string } }>({ op: "locate", ref: "e1" }).doc;
    expect(after.nonce).toBe(before.nonce);            // same document: the nonce cannot tell
    expect(after.href).toBe(location.href);
    expect(after.href).not.toBe(before.href);
    history.pushState({}, "", before.href);
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

  it("resolves a click at x,y on a span inside a submit button to that button", () => {
    document.body.innerHTML = `<form action="/pay"><button type="submit" id="b"><span id="s">Go</span></button></form>`;
    document.elementFromPoint = () => document.getElementById("s");
    const out = run<{ found: boolean; facts: { tag: string; type: string; inForm: boolean } }>({ op: "locate", x: 5, y: 5 });
    expect(out.facts).toMatchObject({ tag: "button", type: "submit", inForm: true });
  });

  it("resolves a point in a link, a label's control and a role=button wrapper's real button", () => {
    document.body.innerHTML =
      `<a href="/x" id="a"><img id="i" alt="Logo"></a><label id="lb" for="c">Terms</label><input id="c" type="checkbox">` +
      `<div role="button" id="w"><button type="submit" id="in">Inner</button></div>`;
    const at = (id: string) => {
      document.elementFromPoint = () => document.getElementById(id);
      return run<{ facts: { tag: string; fieldId?: string; role: string } }>({ op: "locate", x: 1, y: 1 }).facts;
    };
    expect(at("i")).toMatchObject({ tag: "a" });
    expect(at("lb")).toMatchObject({ tag: "input", fieldId: "c" });
    // the weak wrapper does not mask the strong control under the pointer
    expect(at("in")).toMatchObject({ tag: "button" });
  });

  it("returns the frame itself for a point inside an iframe", () => {
    document.body.innerHTML = `<iframe id="f"></iframe>`;
    document.elementFromPoint = () => document.getElementById("f");
    expect(run<{ facts: { tag: string } }>({ op: "locate", x: 1, y: 1 }).facts.tag).toBe("iframe");
  });

  it("descends into a shadow root for the element under the point", () => {
    document.body.innerHTML = `<div id="host"></div>`;
    const host = document.getElementById("host")!;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<button type="submit" id="in">Pay</button>`;
    document.elementFromPoint = () => host;
    Object.defineProperty(root, "elementFromPoint", { configurable: true, value: () => root.getElementById("in") });
    expect(run<{ facts: { tag: string; type: string } }>({ op: "locate", x: 1, y: 1 }).facts).toMatchObject({ tag: "button", type: "submit" });
  });

  it("reports the element that really receives a click on a ref, when it is another one", () => {
    document.body.innerHTML = `<div role="button" id="w">Open <a href="javascript:x()" id="l">more</a></div>`;
    snapshot();
    document.elementFromPoint = () => document.getElementById("l");
    const out = run<{ facts: { tag: string }; hit?: { tag: string; activationUrl?: string }; covered?: string }>({ op: "locate", ref: "e1" });
    expect(out.covered).toBeUndefined();
    expect(out.facts.tag).toBe("div");
    expect(out.hit).toMatchObject({ tag: "a", activationUrl: "javascript:x()" });
  });

  it("gives each element an opaque identity that two identical buttons do not share and the page cannot read", () => {
    document.body.innerHTML = `<ul><li><button>Delete</button></li><li><button>Delete</button></li></ul>`;
    const [a, b] = Array.from(document.querySelectorAll("button"));
    const html = document.body.innerHTML;
    snapshot();
    const idOfRef = (ref: string) => run<{ id: string }>({ op: "locate", ref }).id;
    expect(idOfRef("e1")).not.toBe(idOfRef("e2"));
    // stable for the same element, also across snapshots
    const first = idOfRef("e1");
    snapshot();
    expect(idOfRef("e1")).toBe(first);
    // the id is not in the page: no attribute, no property the page can copy
    expect(document.body.innerHTML).toBe(html);
    expect(Object.getOwnPropertyNames(a).concat(Object.getOwnPropertyNames(b)).join()).not.toContain(first);
    // the point resolves to the same element identity as its ref
    document.elementFromPoint = () => a;
    expect(run<{ id: string }>({ op: "locate", x: 1, y: 1 }).id).toBe(first);
    document.elementFromPoint = () => b;
    expect(run<{ id: string }>({ op: "locate", x: 1, y: 1 }).id).not.toBe(first);
  });

  it("gives focus and active the identity of the element that really has focus", () => {
    document.body.innerHTML = `<input id="a" aria-label="Rate"><input id="b" aria-label="Rate">`;
    snapshot();
    const a = run<{ id: string }>({ op: "locate", ref: "e1" }).id;
    const b = run<{ id: string }>({ op: "locate", ref: "e2" }).id;
    expect(a).toMatch(/^el\d+$/);
    expect(b).not.toBe(a);
    expect(run<{ id: string }>({ op: "focus", ref: "e1", clear: false }).id).toBe(a);
    expect(run<{ id: string }>({ op: "active" }).id).toBe(a);
    run({ op: "focus", ref: "e2", clear: false });
    expect(run<{ id: string }>({ op: "active" }).id).toBe(b);
  });

  it("reports the identity of the element that really receives a click as hitId", () => {
    document.body.innerHTML = `<div role="button" id="w">Open <a href="/x" id="l">more</a></div>`;
    snapshot();
    document.elementFromPoint = () => document.getElementById("l");
    const out = run<{ id: string; hitId?: string }>({ op: "locate", ref: "e1" });
    document.elementFromPoint = () => document.getElementById("l");
    const link = run<{ id: string }>({ op: "locate", x: 1, y: 1 }).id;
    expect(out.hitId).toBe(link);
    expect(out.hitId).not.toBe(out.id);
  });

  it("selects a native option by label, case-insensitively, and fires change", () => {
    document.body.innerHTML = `<select aria-label="Room"><option value="s">Standard</option><option value="d">Deluxe</option></select>`;
    snapshot();
    const select = document.querySelector("select") as HTMLSelectElement;
    const onChange = vi.fn();
    select.addEventListener("change", onChange);
    expect(run({ op: "select", ref: "e1", text: "deluxe" })).toMatchObject({ native: true, changed: true, option: { label: "Deluxe", value: "d" } });
    expect(select.value).toBe("d");
    expect(onChange).toHaveBeenCalledOnce();
    const miss = run<{ option?: unknown; changed: boolean; options: string[] }>({ op: "select", ref: "e1", text: "suite" });
    expect(miss.option).toBeUndefined();
    expect(miss.changed).toBe(false);
    expect(miss.options).toEqual(["Standard", "Deluxe"]);
  });

  describe("pick and select bind to one option", () => {
    const long = `${"Standard room, ".repeat(30)}and delete everything`;
    const setup = () => {
      document.body.innerHTML = `<select aria-label="Room"><option value="s">Standard</option><option value="d" label="Shown label">hidden text</option><option value="${long}">${long}</option></select>`;
      snapshot();
      return document.querySelector("select") as HTMLSelectElement;
    };
    type Pick = { found: boolean; native: boolean; option?: { id: string; label: string; value: string }; options: string[] };

    it("pick reads the option in full (label as shown, whole value) and changes nothing", () => {
      const select = setup();
      const onChange = vi.fn();
      select.addEventListener("change", onChange);
      const out = run<Pick>({ op: "pick", ref: "e1", text: long });
      expect(out.option).toMatchObject({ label: long, value: long });
      expect(out.option!.label.length).toBeGreaterThan(200);
      expect(run<Pick>({ op: "pick", ref: "e1", text: "shown label" }).option).toMatchObject({ label: "Shown label", value: "d" });
      expect(run<Pick>({ op: "pick", ref: "e1", text: "d" }).option).toMatchObject({ label: "Shown label" });
      expect(select.selectedIndex).toBe(0);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("select with expect changes the value only for that very option", () => {
      const select = setup();
      const id = run<Pick>({ op: "pick", ref: "e1", text: "standard" }).option!.id;
      expect(run({ op: "select", ref: "e1", text: "shown label", expect: id })).toMatchObject({ found: true, changed: false });
      expect(select.value).toBe("s");
      const onChange = vi.fn();
      select.addEventListener("change", onChange);
      expect(run({ op: "select", ref: "e1", text: "standard", expect: id })).toMatchObject({ changed: true, option: { id, label: "Standard" } });
      expect(onChange).toHaveBeenCalledOnce();
    });

    it("select by identity picks the right option even when two have the same value", () => {
      document.body.innerHTML = `<select aria-label="R"><option value="x">Safe</option><option value="x">Danger</option></select>`;
      snapshot();
      const select = document.querySelector("select") as HTMLSelectElement;
      expect(run({ op: "select", ref: "e1", text: "danger" })).toMatchObject({ changed: true });
      expect(select.selectedIndex).toBe(1);
    });
  });

  it("says when the element is not a native dropdown", () => {
    document.body.innerHTML = `<div role="combobox">Pick</div>`;
    snapshot();
    expect(run({ op: "select", ref: "e1", text: "x" })).toMatchObject({ found: true, native: false });
  });

  it("focus reports whether the field had text", () => {
    document.body.innerHTML = `<input value="old"><input>`;
    snapshot();
    expect(run({ op: "focus", ref: "e1", clear: true })).toMatchObject({ found: true, onTarget: true, hadText: true });
    expect(document.activeElement).toBe(document.querySelector("input"));
    expect(run({ op: "focus", ref: "e2", clear: true })).toMatchObject({ found: true, onTarget: true, hadText: false });
  });

  it("focus says when the element did not take focus and reports the element that has it", () => {
    document.body.innerHTML = `<input id="keep"><div role="button" id="d">Pay</div>`;
    snapshot();
    (document.getElementById("keep") as HTMLInputElement).focus();
    // a div without tabindex cannot take focus: focus stays on #keep
    const out = run<{ found: boolean; onTarget: boolean; facts: { fieldId: string } }>({ op: "focus", ref: "e2", clear: false });
    expect(out).toMatchObject({ found: true, onTarget: false, facts: { fieldId: "keep" } });
  });

  it("active descends into a shadow root to the element that really has focus", () => {
    document.body.innerHTML = `<div id="host"></div>`;
    const root = document.getElementById("host")!.attachShadow({ mode: "open" });
    root.innerHTML = `<input id="inner" type="password">`;
    (root.getElementById("inner") as HTMLInputElement).focus();
    expect(run<{ facts: { tag: string; type: string } }>({ op: "active" }).facts).toMatchObject({ tag: "input", type: "password" });
  });
});
