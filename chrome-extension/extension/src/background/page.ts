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

/** Identifies the document and the snapshot an element belongs to; an approval is bound to both. */
export type DocId = { nonce: string; generation: number };

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
    };

export type FocusData = { found: false } | { found: true; onTarget: boolean; hadText: boolean; facts: ElementFacts; doc: DocId };

export type PageOps = {
  snapshot: { args: { maxText: number }; result: SnapshotData };
  /**
   * Scroll the element into view and report where to click and what it is. For x,y the element is the actionable
   * ancestor of whatever is at the point (a span inside a submit button is that button), or the frame element itself.
   */
  locate: { args: { ref?: string; x?: number; y?: number }; result: LocateData };
  /** The element that really has keyboard focus (the body when nothing is focused; an iframe element when focus is inside a frame). */
  active: { args: Record<never, never>; result: { facts: ElementFacts; doc: DocId } };
  /** Focus the element and report which element has focus afterwards: it can differ when the target is not focusable. */
  focus: { args: { ref: string; clear: boolean }; result: FocusData };
  select: {
    args: { ref: string; text: string };
    result: { found: boolean; native: boolean; label?: string; options: string[] };
  };
  text: { args: Record<never, never>; result: string };
};

export type PageRequest = { [K in keyof PageOps]: { op: K } & PageOps[K]["args"] }[keyof PageOps];
export type PageResult<R extends PageRequest> = PageOps[R["op"]]["result"];

export function hermesPage(req: PageRequest): unknown {
  type State = { nonce: string; generation: number; refs: Map<string, Element> };
  const w = globalThis as unknown as { __hermes?: State };
  // Lives as long as this document: a new page starts with a new nonce, and every snapshot starts a new generation.
  const state = (w.__hermes ??= {
    nonce: Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join(""),
    generation: 0,
    refs: new Map<string, Element>(),
  });
  const refs = state.refs;
  const doc = (): DocId => ({ nonce: state.nonce, generation: state.generation });
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

  const isSearch = (el: Element, form: Element | null) => {
    if (inputType(el) === "search" || el.closest("[role=search]")) return true;
    if (!form || form.querySelector("input[type=password]")) return false;
    const method = (attr(form, "method") ?? "get").toLowerCase();
    const fieldWords = `${attr(el, "name") ?? ""} ${el.id}`;
    return method === "get" && /(^|[\s_-])(q|s|query|search|keywords?)($|[\s_-])/i.test(fieldWords);
  };

  const factsOf = (el: Element): ElementFacts => {
    const tag = el.tagName.toLowerCase();
    const form = el.closest("form");
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
      };
    }
    const hit = hitAt(x ?? 0, y ?? 0);
    return hit ? { found: true, x: x ?? 0, y: y ?? 0, facts: factsOf(resolveTarget(hit)), doc: doc() } : { found: false, reason: "no-element" };
  };

  switch (req.op) {
    case "snapshot":
      return snapshot(req.maxText);
    case "locate":
      return locate(req);
    case "active":
      return { facts: factsOf(focusedElement()), doc: doc() };
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
      return { found: true, onTarget, hadText, facts: factsOf(actual), doc: doc() };
    }
    case "select": {
      const el = refs.get(req.ref);
      if (!el || !el.isConnected) return { found: false, native: false, options: [] };
      if (!(el instanceof HTMLSelectElement)) return { found: true, native: false, options: [] };
      const options = Array.from(el.options);
      const want = req.text.trim().toLowerCase();
      const same = (o: HTMLOptionElement) => clean(o.textContent, 200).toLowerCase() === want || o.value.toLowerCase() === want;
      const option = options.find(same) ?? options.find((o) => clean(o.textContent, 200).toLowerCase().includes(want));
      const labels = options.slice(0, 20).map((o) => clean(o.textContent));
      if (!option) return { found: true, native: true, options: labels };
      el.value = option.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { found: true, native: true, label: clean(option.textContent), options: labels };
    }
    case "text":
      return document.body.innerText;
  }
}
