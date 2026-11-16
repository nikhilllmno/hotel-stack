/**
 * Risk classifier: decides whether an action is safe, needs the owner's approval, or is blocked outright.
 * Pure: the in-page script (page.ts) gathers ElementFacts, this module only judges them.
 */

/** What the page script knows about the element that will receive the action. */
export type ElementFacts = {
  tag: string;               // lower-case tag name
  type?: string;             // input type, lower-case
  role: string;              // explicit ARIA role, else the implied one
  name: string;              // accessible name or visible text, trimmed
  inForm: boolean;
  formAction?: string;
  autocomplete?: string;
  fieldName?: string;        // name attribute
  fieldId?: string;          // id attribute
  pageHost: string;
  editable?: boolean;        // text field, textarea or contenteditable
};

export type RiskAction = { kind: "click" | "type" | "press" | "select" | "hover" | "scroll"; key?: string };

export type Risk =
  | { level: "safe" }
  | { level: "needs_approval"; reason: string; name: string }  // reason: why, name: the element
  | { level: "blocked"; reason: string };

const RISKY_NAME =
  /\b(pay|purchase|buy|checkout|place order|order now|book( now)?|reserve|confirm|submit|send|post|publish|delete|remove|cancel|refund|transfer|withdraw|unsubscribe|archive|approve|decline|reject|invite|share|sign up|register)\b/i;
const CARD_FIELD = /card[\s_-]*(number|num|no)|cvv|cvc|expir|security[\s_-]*code/i;
const BLOCKED_URL = /^\s*(javascript|data):/i;
const ENTER_KEYS = new Set(["Enter", " ", "Space"]);

/** Password and payment-card fields: Hermes never types into them. */
export function isSensitiveField(f: ElementFacts): boolean {
  if (f.type === "password") return true;
  const ac = (f.autocomplete ?? "").toLowerCase();
  if (/\bcc-/.test(ac) || /\b(current|new)-password\b/.test(ac)) return true;
  return CARD_FIELD.test(f.fieldName ?? "") || CARD_FIELD.test(f.fieldId ?? "");
}

function isSubmitControl(f: ElementFacts): boolean {
  if (f.tag === "input") return f.type === "submit" || f.type === "image";
  if (f.tag === "button") return f.type === "submit" || (f.inForm && !f.type);
  return false;
}

/** The key of a combo like "Control+A" ("A"); a lone "+" stays "+". */
export function baseKey(combo: string): string {
  return combo === "+" || combo.endsWith("++") ? "+" : (combo.split("+").pop() ?? "");
}

/** Whether a key press puts a character into the field (a single character, also Control+V). */
function isTextKey(combo: string): boolean {
  const key = baseKey(combo);
  return key.length === 1 && key !== " ";
}

function applyApproval(risk: Risk, approved: boolean): Risk {
  return risk.level === "needs_approval" && approved ? { level: "safe" } : risk;
}

/** Judge one action on one element. `approved` skips needs_approval, never blocked. */
export function classifyAction(action: RiskAction, facts: ElementFacts, approved: boolean): Risk {
  const sensitive = isSensitiveField(facts);
  if (sensitive && (action.kind === "type" || (action.kind === "press" && isTextKey(action.key ?? "")))) {
    return {
      level: "blocked",
      reason: `Blocked: Hermes never types into password or payment-card fields (${facts.name || facts.type || facts.tag}). Ask the owner to fill in that field themselves.`,
    };
  }
  return applyApproval(judge(action, facts), approved);
}

function judge(action: RiskAction, f: ElementFacts): Risk {
  const risky = RISKY_NAME.test(f.name);
  const ask = (reason: string): Risk => ({ level: "needs_approval", reason, name: f.name });
  switch (action.kind) {
    case "click":
      if (isSubmitControl(f)) return ask("submits a form");
      if (risky) return ask("risky wording");
      return { level: "safe" };
    case "press": {
      if (!ENTER_KEYS.has(baseKey(action.key ?? ""))) return { level: "safe" };
      if (f.inForm && f.editable) return ask("Enter submits the form");
      if (isSubmitControl(f)) return ask("submits a form");
      if (risky) return ask("risky wording");
      return { level: "safe" };
    }
    case "select":
      if (f.inForm && risky) return ask("risky wording");
      return { level: "safe" };
    default:
      return { level: "safe" };
  }
}

/** Navigation target check: javascript: and data: URLs are never opened. */
export function classifyUrl(url: string): Risk {
  return BLOCKED_URL.test(url)
    ? { level: "blocked", reason: "Blocked: javascript: and data: URLs are never opened. Use a normal http(s) address." }
    : { level: "safe" };
}
