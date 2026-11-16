/**
 * Risk classifier: decides whether an action is safe, needs the owner's approval, or is blocked outright.
 * Pure: the in-page script (page.ts) gathers ElementFacts, this module only judges them.
 *
 * Residual risk: the policy is default-safe. A click on a control with a neutral name that runs a JavaScript write
 * (a "Next" button that saves, a toggle that applies at once) and fields that auto-save while typing still go
 * through as safe. The owner's approval covers what the words, the markup and the form reveal, not what a script does.
 */

/** What the page script knows about the element that will receive the action. */
export type ElementFacts = {
  tag: string;               // lower-case tag name
  type?: string;             // input type, lower-case
  role: string;              // explicit ARIA role, else the implied one
  name: string;              // accessible name (aria-label wins) or visible text, trimmed
  text?: string;             // visible text of the element, kept apart from aria-label so one cannot hide the other
  ariaLabel?: string;
  title?: string;
  value?: string;            // value attribute of buttons and button-like inputs (their caption)
  inForm: boolean;
  formAction?: string;       // raw action attribute of the enclosing form
  formMethod?: string;       // lower-case, "get" when the form has none
  activationUrl?: string;    // absolute URL a click or Enter would open or submit to: link href, formaction, form action
  autocomplete?: string;
  fieldName?: string;        // name attribute
  fieldId?: string;          // id attribute
  pageHost: string;
  editable?: boolean;        // text field, textarea or contenteditable
  search?: boolean;          // a search box: type=search, inside role=search, or a GET form field named like a query
};

export type RiskAction = { kind: "click" | "type" | "press" | "select" | "hover" | "scroll"; key?: string };

export type Risk =
  | { level: "safe" }
  | { level: "needs_approval"; reason: string; name: string }  // reason: why, name: the element
  | { level: "blocked"; reason: string };

const RISKY_WORDS =
  /\b(pay|purchase|buy|checkout|place order|order now|book( now)?|reserve|confirm|submit|send|post|publish|delete|remove|cancel|refund|transfer|withdraw|unsubscribe|archive|approve|decline|reject|invite|share|sign up|register|save|update|apply|done|finish|accept|allow|grant|proceed|continue to (checkout|payment))\b/i;
const CARD_FIELD = /card[\s_-]*(number|num|no)|cvv|cvc|expir|security[\s_-]*code/i;
const BLOCKED_URL = /^(javascript|data|vbscript):/i;
const ACTIVATION_KEYS = new Set(["Enter", " ", "Space"]);
/** Elements whose content the top frame cannot see: whatever is clicked inside them is unknown. */
const OPAQUE_TAGS = new Set(["iframe", "frame", "embed", "object"]);

/** Password, one-time-code and payment-card fields: Hermes never changes their value. */
export function isSensitiveField(f: ElementFacts): boolean {
  if (f.type === "password") return true;
  const ac = (f.autocomplete ?? "").toLowerCase();
  if (/(^|\s)cc-/.test(ac) || /(^|\s)(current-password|new-password|one-time-code)(\s|$)/.test(ac)) return true;
  return CARD_FIELD.test(f.fieldName ?? "") || CARD_FIELD.test(f.fieldId ?? "");
}

function isSubmitControl(f: ElementFacts): boolean {
  if (f.tag === "input") return f.type === "submit" || f.type === "image";
  if (f.tag === "button") return f.type === "submit" || (f.inForm && !f.type);
  return false;
}

const isOpaque = (f: ElementFacts) => OPAQUE_TAGS.has(f.tag);

/** The key of a combo like "Control+A" ("A"); a lone "+" stays "+". */
export function baseKey(combo: string): string {
  return combo === "+" || combo.endsWith("++") ? "+" : (combo.split("+").pop() ?? "");
}

const hasModifier = (combo: string) => combo.length > baseKey(combo).length;

/** Whether a key press changes the value of a text field: characters, Space, Backspace, Delete, paste, cut, undo, redo. */
function editsValue(combo: string): boolean {
  const key = baseKey(combo).toLowerCase();
  if (["backspace", "delete", "space", " "].includes(key)) return true;
  const shortcut = /\b(control|ctrl|meta|cmd|command)\+/i.test(combo);
  return shortcut ? ["v", "x", "z", "y"].includes(key) : key.length === 1;
}

/** Every text that names the control. aria-label does not replace the visible text: a "Continue" label cannot hide "Delete". */
function wording(f: ElementFacts): string {
  return [f.name, f.text, f.ariaLabel, f.title, f.value].filter(Boolean).join(" | ");
}

const isRiskyWording = (f: ElementFacts) => RISKY_WORDS.test(wording(f));

/** Judge one action on one element. `approved` skips needs_approval, never blocked. */
export function classifyAction(action: RiskAction, facts: ElementFacts, approved: boolean): Risk {
  const blocked = blockedReason(action, facts);
  if (blocked) return { level: "blocked", reason: blocked };
  const risk = judge(action, facts);
  return risk.level === "needs_approval" && approved ? { level: "safe" } : risk;
}

/** The strictest verdict over every element that may receive the action (the target and what is under the pointer). */
export function classifyTargets(action: RiskAction, targets: ElementFacts[], approved: boolean): Risk {
  const rank = { safe: 0, needs_approval: 1, blocked: 2 };
  return targets
    .map((f) => classifyAction(action, f, approved))
    .reduce<Risk>((worst, r) => (rank[r.level] > rank[worst.level] ? r : worst), { level: "safe" });
}

function blockedReason(action: RiskAction, f: ElementFacts): string | undefined {
  const key = action.key ?? "";
  const activates = action.kind === "click" || (action.kind === "press" && ACTIVATION_KEYS.has(baseKey(key)));
  const picksOption = action.kind === "click" && (f.role === "option" || f.tag === "option");
  const changesValue = action.kind === "type" || action.kind === "select" || picksOption || (action.kind === "press" && editsValue(key));
  if (changesValue && isSensitiveField(f)) {
    return `Blocked: Hermes never changes password, one-time-code or payment-card fields (${f.name || f.type || f.tag}). Ask the owner to fill in that field themselves.`;
  }
  if (activates && f.activationUrl && classifyUrl(f.activationUrl).level === "blocked") {
    return "Blocked: this would run a javascript:, data: or vbscript: address. Hermes never does that.";
  }
  return undefined;
}

function judge(action: RiskAction, f: ElementFacts): Risk {
  const ask = (reason: string): Risk => ({ level: "needs_approval", reason, name: f.name });
  const safe: Risk = { level: "safe" };
  const opaque = () => ask("the target is inside a frame Hermes cannot read");
  const click = (): Risk => {
    if (isOpaque(f)) return opaque();
    if (isSubmitControl(f)) return ask("submits a form");
    return isRiskyWording(f) ? ask("risky wording") : safe;
  };
  switch (action.kind) {
    case "click":
      return click();
    case "press": {
      const base = baseKey(action.key ?? "");
      if (isOpaque(f)) return opaque();
      if (base === "Enter" && hasModifier(action.key ?? "")) return ask("Enter with a modifier key sends or submits");
      if (!ACTIVATION_KEYS.has(base)) return safe;
      if (f.editable) return base === "Enter" && !f.search ? ask("Enter sends or submits from a text field") : safe;
      return click();
    }
    case "select":
      if (isOpaque(f)) return opaque();
      return f.inForm && !f.search ? ask("changes a form field") : safe;
    case "type":
      return isOpaque(f) ? opaque() : safe;
    default:
      return safe;
  }
}

/** Navigation target check: javascript:, data: and vbscript: URLs are never opened. */
export function classifyUrl(url: string): Risk {
  // Browsers drop tabs, newlines and spaces inside a scheme ("java\tscript:").
  return BLOCKED_URL.test(url.replace(/[\u0000-\u0020]/g, ""))
    ? { level: "blocked", reason: "Blocked: javascript:, data: and vbscript: URLs are never opened. Use a normal http(s) address." }
    : { level: "safe" };
}
