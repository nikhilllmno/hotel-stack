import type { ElementFacts } from "./risk";

/** The in-page half of the executor. `hermesPage` runs inside the tab (chrome.scripting, ISOLATED world), so it must stay self-contained. */

export type SnapshotElement = {
  ref: string;
  facts: ElementFacts;
  href?: string;
  value?: string;
  disabled: boolean;
  checked: boolean;
};

export type SnapshotData = {
  url: string;
  title: string;
  scrollX: number;
  scrollY: number;
  pageHeight: number;
  viewport: { width: number; height: number };
  iframes: number;
  total: number;            // interactive elements found; `elements` is capped
  elements: SnapshotElement[];
  text: string;
  textLeft: number;         // characters of visible text cut off by max_text
};

/**
 * Identifies the document, the snapshot and the address an element belongs to; an approval is bound to all three.
 * `href` changes with a same-document route change (history.pushState, a hash), which the nonce does not see.
 */
export type DocId = { nonce: string; generation: number; href: string };

export type LocateData =
  | { found: false; reason: "gone" | "no-element" }
  | {
      found: true;
      x: number;
      y: number;
      facts: ElementFacts;
      /** The element that really receives the click when it is not `facts` (a link inside a div[role=button], a parent of a transparent overlay). */
      hit?: ElementFacts;
      covered?: string;
      doc: DocId;
      /** Opaque identity of `facts`' element and of `hit`'s: the same element has the same id for the life of the document. */
      id: string;
      hitId?: string;
    };

export type FocusData =
  | { found: false }
  | { found: true; onTarget: boolean; hadText: boolean; facts: ElementFacts; doc: DocId; id: string };

/** The option a select would pick. `label` and `value` are whole, never cut. */
export type PickedOption = { id: string; label: string; value: string };
export type PickData = { found: boolean; native: boolean; option?: PickedOption; options: string[] };

export type PageOps = {
  snapshot: { args: { maxText: number }; result: SnapshotData };
  /**
   * Scroll the element into view and report where to click and what it is. For x,y the element is the actionable
   * ancestor of whatever is at the point (a span inside a submit button is that button), or the frame element itself.
   */
  locate: { args: { ref?: string; x?: number; y?: number }; result: LocateData };
  /** The element that really has keyboard focus (the body when nothing is focused; an iframe element when focus is inside a frame). */
  active: { args: Record<never, never>; result: { facts: ElementFacts; doc: DocId; id: string } };
  /** Focus the element and report which element has focus afterwards: it can differ when the target is not focusable. */
  focus: { args: { ref: string; clear: boolean }; result: FocusData };
  /** Read-only: which option of a native dropdown `text` names, in full (label as shown, value) and by identity. Nothing is changed. */
  pick: { args: { ref: string; text: string }; result: PickData };
  /** Choose the option. With `expect`, only if it is still the option with that identity: the owner approved that one. */
  select: { args: { ref: string; text: string; expect?: string }; result: PickData & { changed: boolean } };
  text: { args: Record<never, never>; result: string };
};

export type PageRequest = { [K in keyof PageOps]: { op: K } & PageOps[K]["args"] }[keyof PageOps];
export type PageResult<R extends PageRequest> = PageOps[R["op"]]["result"];

export function hermesPage(req: PageRequest): unknown {
  type State = { nonce: string; generation: number; refs: Map<string, Element>; ids: WeakMap<Element, string>; nextId: number };
  const w = globalThis as unknown as { __hermes?: State };
  // Lives as long as this document: a new page starts with a new nonce, and every snapshot starts a new generation.
  const state = (w.__hermes ??= {
    nonce: Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join(""),
    generation: 0,
    refs: new Map<string, Element>(),
    ids: new WeakMap<Element, string>(),
    nextId: 0,
  });
  const refs = state.refs;
  const doc = (): DocId => ({ nonce: state.nonce, generation: state.generation, href: location.href });
  /**
   * Opaque identity of an element, kept in a WeakMap in this isolated world: the page cannot read or copy it, unlike
   * an attribute. Two identical "Delete" buttons in different rows get different ids.
   */
  const idOf = (el: Element): string => {
    let id = state.ids.get(el);
    if (!id) state.ids.set(el, (id = `el${++state.nextId}`));
    return id;
  };
  const SELECTOR =
    'a[href],button,input:not([type=hidden]),select,textarea,summary,[contenteditable=""],[contenteditable=true],[onclick],' +
    "[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=option],[role=combobox]";
  const MAX_ELEMENTS = 400;
  const NOT_TEXT_INPUT = ["button", "submit", "reset", "image", "checkbox", "radio", "file", "range", "color", "hidden"];

  const clean = (s: string | null | undefined, max = 80) => {
    const t = (s ?? "").replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
  };
  const attr = (el: Element, name: string) => el.getAttribute(name) ?? undefined;

  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  };

  const inputType = (el: Element) => (el instanceof HTMLInputElement ? el.type.toLowerCase() : undefined);

  const roleOf = (el: Element): string => {
    const explicit = attr(el, "role")?.split(/\s+/)[0];
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return (el as HTMLSelectElement).multiple ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = inputType(el) ?? "text";
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox" || type === "radio") return type;
      if (type === "range") return "slider";
      if (type === "file") return "file";
      return "textbox";
    }
    if (el instanceof HTMLElement && el.isContentEditable) return "textbox";
    return "clickable";
  };

  const nameOf = (el: Element): string => {
    const label = attr(el, "aria-label");
    if (label) return clean(label);
    const by = attr(el, "aria-labelledby");
    if (by) {
      const text = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      if (clean(text)) return clean(text);
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      const labelText = clean(el.labels?.[0]?.textContent);
      if (labelText) return labelText;
      if (el instanceof HTMLInputElement && ["button", "submit", "reset"].includes(el.type) && el.value) return clean(el.value);
      if (el instanceof HTMLInputElement && el.type === "image") return clean(el.alt) || "image button";
      return clean(attr(el, "placeholder")) || clean(attr(el, "title")) || clean(attr(el, "name"));
    }
    return clean(el.textContent) || clean(el.querySelector("img[alt]")?.getAttribute("alt")) || clean(attr(el, "title"));
  };

  const isEditable = (el: Element) => {
    if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
    if (el instanceof HTMLInputElement) return !NOT_TEXT_INPUT.includes(el.type) && !el.readOnly && !el.disabled;
    return el instanceof HTMLElement && el.isContentEditable;
  };

  const STRONG = "a,area,button,input,select,textarea,summary,label";
  const WEAK =
    '[role=button],[role=link],[role=menuitem],[role=tab],[role=option],[role=checkbox],[role=switch],[role=radio],[role=combobox],[onclick],[contenteditable=""],[contenteditable=true]';
  const OPAQUE = "iframe,frame,embed,object";

  /** What a click on `hit` activates: the nearest real control around it (a label gives its control), else the frame or the hit itself. */
  const resolveTarget = (hit: Element): Element => {
    if (hit.matches(OPAQUE)) return hit;
    const el = hit.closest(STRONG) ?? hit.closest(WEAK) ?? hit;
    return el instanceof HTMLLabelElement && el.control ? el.control : el;
  };

  const hitAt = (x: number, y: number): Element | null => {
    let hit = document.elementFromPoint(x, y);
    while (hit?.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    return hit;
  };

  const focusedElement = (): Element => {
    let el = document.activeElement ?? document.body;
    while (el.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  };

  const absolute = (raw: string) => {
    try {
      return new URL(raw, location.href).href;
    } catch {
      return raw;
    }
  };

  /** Where a click or Enter on this element goes: a link's href, a submit control's formaction, else its form's action. */
  const activationUrlOf = (el: Element, form: Element | null): string | undefined => {
    const href = el.matches("a[href],area[href]") ? attr(el, "href") : undefined;
    const raw = href ?? attr(el, "formaction") ?? (form ? attr(form, "action") : undefined);
    return raw ? absolute(raw) : undefined;
  };

  /** The form the element submits: its own form attribute counts, so a field outside the <form> tag is still in that form. */
  const formOf = (el: Element): HTMLFormElement | null => {
    const owner = (el as HTMLInputElement).form;
    return owner instanceof HTMLFormElement ? owner : el.closest("form");
  };

  /** Every button and input that belongs to the form: inside it, tied to it with form="id", or reporting it as its .form. */
  const controlsOf = (form: Element): Element[] => {
    const all = new Set<Element>(form.querySelectorAll("button, input"));
    if (form.id) for (const c of document.querySelectorAll("button, input")) if (attr(c, "form") === form.id) all.add(c);
    for (const c of document.querySelectorAll("button, input")) if ((c as HTMLButtonElement).form === form) all.add(c);
    return [...all];
  };

  /** Controls that submit the form: button with type submit or none, input type submit or image. <input type=image> is not in form.elements. */
  const isSubmitter = (c: Element) => {
    if (c instanceof HTMLButtonElement) {
      const type = attr(c, "type")?.trim().toLowerCase();
      return type !== "button" && type !== "reset";
    }
    return c instanceof HTMLInputElement && ["submit", "image"].includes(c.type);
  };

  /**
   * A search exception: Enter here only reads. A field outside any form qualifies when it is type=search or inside
   * role=search. A field in a form qualifies only when the form is GET and no submitter overrides that with
   * formmethod, however the field is marked: Enter in a POST form submits it.
   */
  const isSearch = (el: Element, form: Element | null) => {
    const marked = inputType(el) === "search" || el.closest("[role=search]") !== null;
    if (!form) return marked;
    const controls = controlsOf(form);
    if (controls.some((c) => inputType(c) === "password")) return false;
    const method = (attr(form, "method") ?? "get").trim().toLowerCase();
    const overridden = controls.some((c) => isSubmitter(c) && (attr(c, "formmethod") ?? "get").trim().toLowerCase() !== "get");
    if (method !== "get" || overridden) return false;
    const fieldWords = `${attr(el, "name") ?? ""} ${el.id}`;
    return marked || /(^|[\s_-])(q|s|query|search|keywords?)($|[\s_-])/i.test(fieldWords);
  };

  const factsOf = (el: Element): ElementFacts => {
    const tag = el.tagName.toLowerCase();
    const form = formOf(el);
    // An option takes the facts of the dropdown it belongs to, so a card-expiry option is as sensitive as the field.
    const field = tag === "option" || attr(el, "role") === "option" ? (el.closest("select,[role=listbox],[role=combobox]") ?? el) : el;
    const control = el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
    const captionInput = el instanceof HTMLInputElement && ["button", "submit", "reset", "image"].includes(el.type);
    return {
      tag,
      type: tag === "button" ? attr(el, "type")?.toLowerCase() : inputType(field),
      role: roleOf(el),
      name: nameOf(el),
      text: control ? undefined : clean((el as HTMLElement).innerText || el.textContent, 200) || undefined,
      ariaLabel: clean(attr(el, "aria-label")) || undefined,
      title: clean(attr(el, "title")) || undefined,
      value: captionInput ? clean((el as HTMLInputElement).value) || undefined : tag === "button" ? clean(attr(el, "value")) || undefined : undefined,
      inForm: form !== null,
      formAction: form ? attr(form, "action") : undefined,
      formMethod: form ? (attr(form, "method") ?? "get").toLowerCase() : undefined,
      activationUrl: activationUrlOf(el, form),
      autocomplete: attr(field, "autocomplete"),
      fieldName: attr(field, "name"),
      fieldId: field.id || undefined,
      pageHost: location.hostname,
      editable: isEditable(el),
      search: isSearch(el, form),
    };
  };

  const valueOf = (el: Element): string | undefined => {
    if (el instanceof HTMLSelectElement) return clean(el.selectedOptions[0]?.textContent);
    if (el instanceof HTMLInputElement) return ["checkbox", "radio", "button", "submit", "reset", "image", "file"].includes(el.type) ? undefined : el.value;
    if (el instanceof HTMLTextAreaElement) return el.value;
    return undefined;
  };

  const hrefOf = (el: Element): string | undefined => {
    if (!(el instanceof HTMLAnchorElement) || !el.getAttribute("href")) return undefined;
    const u = new URL(el.href, location.href);
    return clean(u.origin === location.origin ? u.pathname + u.search + u.hash : u.href, 100);
  };

  const hasPointerCursor = (el: Element) => {
    const t = clean(el.textContent);
    if (!t || t.length > 80 || getComputedStyle(el).cursor !== "pointer") return false;
    return !el.parentElement || getComputedStyle(el.parentElement).cursor !== "pointer";
  };

  const snapshot = (maxText: number): SnapshotData => {
    refs.clear();
    state.generation++;
    const found: Element[] = [];
    let scanned = 0;
    for (const el of document.body.querySelectorAll("*")) {
      if (++scanned > 5000) break;
      if (!visible(el)) continue;
      if (el.matches(SELECTOR) || (!el.closest(SELECTOR) && hasPointerCursor(el))) found.push(el);
    }
    const elements = found.slice(0, MAX_ELEMENTS).map((el, i): SnapshotElement => {
      const ref = `e${i + 1}`;
      refs.set(ref, el);
      const checkedAttr = attr(el, "aria-checked") === "true";
      return {
        ref,
        facts: factsOf(el),
        href: hrefOf(el),
        value: valueOf(el),
        disabled: (el as HTMLButtonElement).disabled === true || attr(el, "aria-disabled") === "true",
        checked: (el as HTMLInputElement).checked === true || checkedAttr,
      };
    });
    const all = document.body.innerText.replace(/\n{3,}/g, "\n\n").trim();
    return {
      url: location.href,
      title: document.title,
      scrollX: Math.round(scrollX),
      scrollY: Math.round(scrollY),
      pageHeight: document.documentElement.scrollHeight,
      viewport: { width: innerWidth, height: innerHeight },
      iframes: document.querySelectorAll("iframe,frame").length,
      total: found.length,
      elements,
      text: all.slice(0, maxText),
      textLeft: Math.max(0, all.length - maxText),
    };
  };

  const locate = ({ ref, x, y }: { ref?: string; x?: number; y?: number }): LocateData => {
    if (ref !== undefined) {
      const el = refs.get(ref);
      if (!el || !el.isConnected) return { found: false, reason: "gone" };
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      const cx = (Math.max(r.left, 0) + Math.min(r.right, innerWidth)) / 2;
      const cy = (Math.max(r.top, 0) + Math.min(r.bottom, innerHeight)) / 2;
      const hit = hitAt(cx, cy);
      const covered = hit && !el.contains(hit) && !hit.contains(el) ? nameOf(hit) || hit.tagName.toLowerCase() : undefined;
      const receiver = hit && !covered ? resolveTarget(hit) : undefined;
      return {
        found: true,
        x: cx,
        y: cy,
        facts: factsOf(el),
        hit: receiver && receiver !== el ? factsOf(receiver) : undefined,
        covered,
        doc: doc(),
        id: idOf(el),
        hitId: receiver && receiver !== el ? idOf(receiver) : undefined,
      };
    }
    const hit = hitAt(x ?? 0, y ?? 0);
    if (!hit) return { found: false, reason: "no-element" };
    const target = resolveTarget(hit);
    return { found: true, x: x ?? 0, y: y ?? 0, facts: factsOf(target), doc: doc(), id: idOf(target) };
  };

  const whole = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim();

  /** Finds the option of a native dropdown that `text` names (label as shown or value, else a label containing it). */
  const pick = (ref: string, text: string) => {
    const el = refs.get(ref);
    if (!el || !el.isConnected) return { data: { found: false, native: false, options: [] } as PickData };
    if (!(el instanceof HTMLSelectElement)) return { data: { found: true, native: false, options: [] } as PickData };
    const options = Array.from(el.options);
    const want = text.trim().toLowerCase();
    const shown = (o: HTMLOptionElement) => whole(o.label || o.textContent).toLowerCase();
    const same = (o: HTMLOptionElement) => shown(o) === want || whole(o.textContent).toLowerCase() === want || o.value.toLowerCase() === want;
    const option = options.find(same) ?? options.find((o) => shown(o).includes(want));
    const labels = options.slice(0, 20).map((o) => clean(o.label || o.textContent));
    const data: PickData = { found: true, native: true, options: labels };
    if (option) data.option = { id: idOf(option), label: whole(option.label || option.textContent), value: option.value };
    return { data, el, option };
  };

  switch (req.op) {
    case "snapshot":
      return snapshot(req.maxText);
    case "locate":
      return locate(req);
    case "active": {
      const el = focusedElement();
      return { facts: factsOf(el), doc: doc(), id: idOf(el) };
    }
    case "focus": {
      const el = refs.get(req.ref);
      if (!el || !el.isConnected) return { found: false };
      (el as HTMLElement).focus();
      const actual = focusedElement();
      const onTarget = actual === el;
      const hadText = ((el as HTMLInputElement).value ?? el.textContent ?? "").length > 0;
      if (onTarget && req.clear && hadText) {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select();
        else getSelection()?.selectAllChildren(el);
      }
      return { found: true, onTarget, hadText, facts: factsOf(actual), doc: doc(), id: idOf(actual) };
    }
    case "pick":
      return pick(req.ref, req.text).data;
    case "select": {
      const { data, el, option } = pick(req.ref, req.text);
      if (!el || !option || !data.option) return { ...data, changed: false };
      if (req.expect !== undefined && data.option.id !== req.expect) return { ...data, changed: false };
      (el as HTMLSelectElement).selectedIndex = option.index;  // this very option, even when another one has the same value
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ...data, changed: true };
    }
    case "text":
      return document.body.innerText;
  }
}
