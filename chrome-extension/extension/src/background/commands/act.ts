import type { ActArgs } from "../../shared/protocol";
import { getWorkableTab, type Tab } from "../agent-tab";
import { cursor } from "../cursor";
import { CommandError, ensureCurrent, type IsCurrent } from "../errors";
import { insertText, mouseClick, mouseMove, pressKey, visualViewport, wheel } from "../input";
import { parseKey } from "../keys";
import { canonicalArgs, createApproval, factsKey, takeApproval } from "../approvals";
import { callPage } from "../page-call";
import type { DocId, PickData } from "../page";
import { classifyAction, classifyTargets, type ElementFacts, type Risk, type RiskAction } from "../risk";
import { settle } from "../tab-load";
import { pageLine } from "./page-line";
import type { CommandOutput } from "./types";

/**
 * What the action will hit. `facts` is the element that gets it; `targets` is every element judged (facts, plus what
 * really receives a click when that is another element). `unresolved`: Hermes could not tell which element has focus.
 */
export type Aim = {
  facts: ElementFacts;
  targets: ElementFacts[];
  ids: string[];         // opaque identity of each of `targets`, in the same order (page.ts)
  point?: { x: number; y: number };
  doc?: DocId;
  pick?: PickData;       // select: the option the text names, resolved before anything is asked or done
  offTarget?: boolean;   // press with a ref: the element could not take focus, so the key goes to `facts`, the one that has it
  unresolved?: boolean;
};

const NO_FACTS: ElementFacts = { tag: "unknown", role: "unknown", name: "", inForm: false, pageHost: "" };

/** Throws when the connection that sent the command is gone. Called right before every change to Chrome. */
type Live = () => void;

const ACTION_WORDS: Record<ActArgs["action"], string> = {
  click: "click",
  type: "text entry",
  press: "key press",
  scroll: "scroll",
  select: "selection",
  hover: "hover",
};

const staleRef = (ref: string) => new CommandError(`Element ${ref} is gone. Take a new snapshot.`);
const describe = (f: ElementFacts) => (f.name ? `${f.role} "${f.name}"` : f.role);

function requireArgs(a: ActArgs): void {
  const hasTarget = a.ref !== undefined || (a.x !== undefined && a.y !== undefined);
  const needs = (ok: boolean, what: string) => {
    if (!ok) throw new CommandError(`'${a.action}' needs ${what}.`);
  };
  if (a.action === "click" || a.action === "hover") needs(hasTarget, "a ref from the last snapshot, or x and y");
  if (a.action === "type") needs(hasTarget && a.text !== undefined, "text and a ref from the last snapshot (or x and y)");
  if (a.action === "select") needs(a.ref !== undefined && a.text !== undefined, "a ref from the last snapshot and text (the option label or value)");
  if (a.action === "press") {
    needs(!!a.key, "key, for example Enter, Tab, Escape, ArrowDown or Control+A");
    needs(a.x === undefined && a.y === undefined, "no x and y: pass a ref to press the key on an element, or nothing to press it where focus is");
  }
  if (a.action === "scroll") needs(!!a.direction, "direction: up, down, left or right");
}

/** Scroll the target into view and read what is there. A press goes to the element that has focus, so it is read after focusing. */
async function aim(tab: Tab, a: ActArgs, live: Live): Promise<Aim> {
  const hasPoint = a.x !== undefined && a.y !== undefined;
  if (a.action === "press") {
    if (a.ref !== undefined) {
      live();
      const focused = await callPage(tab, { op: "focus", ref: a.ref, clear: false });
      if (!focused?.found) throw staleRef(a.ref);
      return { facts: focused.facts, targets: [focused.facts], ids: [focused.id], doc: focused.doc, offTarget: !focused.onTarget };
    }
    const active = await callPage(tab, { op: "active" });
    return active?.facts
      ? { facts: active.facts, targets: [active.facts], ids: [active.id], doc: active.doc }
      : { facts: NO_FACTS, targets: [NO_FACTS], ids: [], unresolved: true };
  }
  if (a.ref === undefined && !hasPoint) return { facts: NO_FACTS, targets: [], ids: [] };  // scroll the page
  live();  // locate scrolls the element into view
  const found = await callPage(tab, { op: "locate", ref: a.ref, x: a.x, y: a.y });
  if (!found.found) {
    throw found.reason === "gone" ? staleRef(a.ref ?? "") : new CommandError(`Nothing is at (${a.x}, ${a.y}) in the viewport. Take a screenshot to find the right position.`);
  }
  if (found.covered) {
    throw new CommandError(`Element ${a.ref} is covered by "${found.covered}". Close or dismiss that first, then take a new snapshot.`);
  }
  // Resolve the option now, before the owner is asked: the approval is for this option, not for the words the agent used.
  if (a.action === "select") live();
  const pick = a.action === "select" ? await callPage(tab, { op: "pick", ref: a.ref ?? "", text: a.text ?? "" }) : undefined;
  return {
    facts: found.facts,
    targets: found.hit ? [found.facts, found.hit] : [found.facts],
    ids: found.hit ? [found.id, found.hitId ?? ""] : [found.id],
    point: { x: found.x, y: found.y },
    doc: found.doc,
    pick,
  };
}

function riskAction(a: ActArgs): RiskAction {
  return { kind: a.action, key: a.key ? parseKey(a.key).combo : undefined };
}

/** Collects tabs the page opens (target=_blank, window.open) while an action runs. */
function watchNewTabs(): () => chrome.tabs.Tab[] {
  const opened: chrome.tabs.Tab[] = [];
  const onCreated = (tab: chrome.tabs.Tab) => opened.push(tab);
  chrome.tabs.onCreated.addListener(onCreated);
  return () => {
    chrome.tabs.onCreated.removeListener(onCreated);
    return opened;
  };
}

const stoppedAt = (r: Risk): CommandOutput | undefined =>
  r.level === "blocked" ? { status: "blocked", text: r.reason } : undefined;

async function typeInto(tab: Tab, a: ActArgs, aimed: Aim, live: Live): Promise<CommandOutput> {
  const { facts } = aimed;
  if (!facts.editable) {
    throw new CommandError(`${describe(facts)} is not a text field, so nothing can be typed into it. Pick a textbox from the snapshot.`);
  }
  const clear = a.clear !== false;
  if (aimed.point) {  // the cursor goes to the field first; it pulses only when the text field really gets clicked
    live();
    await cursor.moveTo(tab, aimed.point.x, aimed.point.y, { pulse: a.ref === undefined });
  }
  // Check again where the text will really go: the element that ends up focused, not the one that was aimed at.
  const recheck = (focused: ElementFacts) => stoppedAt(classifyAction({ kind: "type" }, focused, true));
  if (a.ref !== undefined) {
    live();
    const focused = await callPage(tab, { op: "focus", ref: a.ref, clear });
    if (!focused?.found) throw staleRef(a.ref);
    if (!focused.onTarget) throw new CommandError(`${describe(facts)} did not take keyboard focus, so nothing was typed. Click it first, then take a new snapshot.`);
    const stop = recheck(focused.facts);
    if (stop) return stop;
    if (clear && focused.hadText) {
      live();
      await pressKey(tab, "Backspace");
    }
  } else if (aimed.point) {
    live();
    await mouseClick(tab, aimed.point.x, aimed.point.y);
    const active = await callPage(tab, { op: "active" });
    if (!active?.facts) throw new CommandError("Could not tell which element took focus after the click, so nothing was typed.");
    const stop = recheck(active.facts);
    if (stop) return stop;
    if (clear) {
      live();
      await pressKey(tab, "Control+A");
      live();
      await pressKey(tab, "Backspace");
    }
  }
  live();
  await cursor.say(tab, "Typing...");
  await insertText(tab, a.text ?? "");
  await cursor.say(tab, null);
  return { text: `Typed ${(a.text ?? "").length} characters into ${describe(facts)}.` };
}

/** The option a select would choose, or the sentence that says why there is none. */
function requireOption(a: ActArgs, aimed: Aim): NonNullable<PickData["option"]> {
  const picked = aimed.pick;
  if (!picked?.found) throw staleRef(a.ref ?? "");
  if (!picked.native) throw new CommandError(`${describe(aimed.facts)} is not a native dropdown. Click it, then click the option you want.`);
  if (!picked.option) throw new CommandError(`${describe(aimed.facts)} has no option "${a.text}". Options: ${picked.options.join(", ")}.`);
  return picked.option;
}

/** Chooses the option that was resolved (and approved) earlier. If the dropdown no longer resolves to that very option, nothing is selected. */
async function selectOption(tab: Tab, a: ActArgs, aimed: Aim, live: Live): Promise<string> {
  const expected = requireOption(a, aimed);
  live();
  const picked = await callPage(tab, { op: "select", ref: a.ref ?? "", text: a.text ?? "", expect: expected.id });
  if (!picked.found) throw staleRef(a.ref ?? "");
  if (!picked.changed || !picked.option) {
    throw new CommandError(`The options of ${describe(aimed.facts)} changed since they were read, so nothing was selected. Take a new snapshot.`);
  }
  return `Selected "${picked.option.label}" in ${describe(aimed.facts)}.`;
}

async function scroll(tab: Tab, a: ActArgs, aimed: Aim, live: Live): Promise<string> {
  const v = await visualViewport(tab);
  const horizontal = a.direction === "left" || a.direction === "right";
  const amount = a.amount ?? (horizontal ? v.clientWidth : v.clientHeight);
  const sign = a.direction === "up" || a.direction === "left" ? -1 : 1;
  const at = aimed.point ?? { x: v.clientWidth / 2, y: v.clientHeight / 2 };
  live();
  await cursor.moveTo(tab, at.x, at.y);
  await wheel(tab, at.x, at.y, horizontal ? sign * amount : 0, horizontal ? 0 : sign * amount);
  return `Scrolled ${a.direction} ${amount} px.`;
}

async function perform(tab: Tab, a: ActArgs, aimed: Aim, live: Live): Promise<CommandOutput> {
  const { facts, point } = aimed;
  switch (a.action) {
    case "click":
      live();
      await cursor.moveTo(tab, point!.x, point!.y, { pulse: true });  // the cursor arrives first, then the real click goes in
      await mouseClick(tab, point!.x, point!.y);
      return { text: `Clicked ${describe(facts)}.` };
    case "hover":
      live();
      await cursor.moveTo(tab, point!.x, point!.y);
      await mouseMove(tab, point!.x, point!.y);
      return { text: `Hovered over ${describe(facts)}.` };
    case "type":
      return typeInto(tab, a, aimed, live);
    case "press":
      live();
      await cursor.say(tab, a.key ?? "", { ttl: cursor.keyMs });
      await pressKey(tab, a.key ?? "");
      return { text: `Pressed ${a.key}${a.ref ? ` on ${describe(facts)}` : ""}.` };
    case "select":
      if (point) {
        live();
        await cursor.moveTo(tab, point.x, point.y);
      }
      return { text: await selectOption(tab, a, aimed, live) };
    case "scroll":
      return { text: await scroll(tab, a, aimed, live) };
  }
}

/** The longest text the owner is shown in full. Longer text is not clipped: no approval is filed for it. */
export const MAX_SHOWN_CHARS = 500;

/** Role and accessible name, plus the visible text and title when they say something else: <button aria-label="Preview">Delete account</button>. */
function describeFully(f: ElementFacts): string {
  const same = (t: string | undefined) => (t ?? "").trim().toLowerCase() === f.name.trim().toLowerCase();
  const visible = f.text ?? f.value;
  const extra = [visible && !same(visible) ? `visible text: "${visible}"` : "", f.title && !same(f.title) && f.title !== visible ? `title: "${f.title}"` : ""].filter(Boolean);
  return extra.length ? `${describe(f)} (${extra.join("; ")})` : describe(f);
}

/** Where a click or Enter on this element goes, when the page says: a link's address, or the form's method and action. */
function destinationOf(f: ElementFacts): string | undefined {
  if (f.inForm && f.tag !== "a") return `form ${(f.formMethod ?? "get").toUpperCase()} to ${f.activationUrl ?? "this same page (the form has no action)"}`;
  return f.activationUrl ? `opens ${f.activationUrl}` : undefined;
}

/** Why no approval can be filed, when the decisive text is too long to show whole; undefined when it can. */
export function approvalRefusal(a: ActArgs, aimed: Aim): string | undefined {
  const option = aimed.pick?.option;
  const texts = a.action === "select" ? [a.text ?? "", option?.label ?? "", option?.value ?? ""] : a.action === "type" ? [a.text ?? ""] : [];
  if (!texts.some((t) => t.length > MAX_SHOWN_CHARS)) return undefined;
  return a.action === "select"
    ? `Blocked: option text too long to show the owner (more than ${MAX_SHOWN_CHARS} characters), so no approval can be filed. Pick another option, or ask the owner to choose it.`
    : `Blocked: the text is too long to show the owner (more than ${MAX_SHOWN_CHARS} characters), so no approval can be filed. Type shorter text, or ask the owner to enter it.`;
}

/** What the owner is asked to approve, in words, from the extension's own facts: the side panel shows this instead of the agent's (cut-off) arguments. */
export function summarize(a: ActArgs, aimed: Aim, risk: { reason: string }): string {
  const who = describeFully(aimed.facts);
  const option = aimed.pick?.option;
  const lands = aimed.targets[1];
  let what: string;
  switch (a.action) {
    case "click":
      what = `Click ${who}${lands ? `, landing on ${describeFully(lands)}` : ""}`;
      break;
    case "hover":
      what = `Hover over ${who}`;
      break;
    case "type":
      what = `Type "${a.text ?? ""}" into ${who}`;
      break;
    case "press":
      what = `Press ${a.key} in ${who}`;
      break;
    case "select":
      what = option
        ? `Select the option "${option.label}" (value "${option.value}")${[option.label, option.value].includes(a.text ?? "") ? "" : ` (the agent asked for "${a.text}")`} in ${who}`
        : `Select "${a.text}" in ${who}`;
      break;
    case "scroll":
      what = `Scroll ${a.direction}`;
      break;
  }
  const where = aimed.targets.slice(0, 2).map((f, i) => {
    const d = destinationOf(f);
    return d ? `${i === 0 ? "Destination" : "Destination of what is under the pointer"}: ${d}` : "";
  });
  return [what, risk.reason ? `Needs approval because: ${risk.reason}` : "", ...where].filter(Boolean).join("\n");
}

/** Files an approval for what was just judged and tells the agent how to ask for it. approval_id comes first: Hermes cuts long text. */
async function askApproval(tab: Tab, a: ActArgs, aimed: Aim, why: string, risk: { reason: string; name: string }): Promise<CommandOutput> {
  const refusal = approvalRefusal(a, aimed);
  if (refusal) return { status: "blocked", text: refusal };
  if (aimed.point) await cursor.moveTo(tab, aimed.point.x, aimed.point.y);  // show what is waiting, without clicking it
  await cursor.say(tab, "Waiting for approval");
  const href = aimed.doc?.href ?? "";
  const id = await createApproval({
    tabId: tab.id,
    docNonce: aimed.doc?.nonce ?? "",
    generation: aimed.doc?.generation ?? -1,
    href,
    args: canonicalArgs(a),
    facts: aimed.targets.map(factsKey),
    elementIds: aimed.ids,
    option: optionKey(aimed),
    summary: summarize(a, aimed, risk),
    pageUrl: href || tab.url || "",
  });
  const what = risk.name ? `${risk.reason}: "${risk.name}"` : risk.reason;
  return {
    status: "needs_approval",
    text:
      `approval_id: ${id}\n` +
      "Call act_with_approval with approval_id first, then the same arguments, then a short reason (under 200 characters). " +
      "The id works once, for 10 minutes, on this page as it is now.\n" +
      `Not done: this ${ACTION_WORDS[a.action]} needs the owner's approval (${what}). ${why}`.trimEnd(),
  };
}

/** Identity, label and value of the option a select would choose ("" for other actions): the owner approved that option. */
const optionKey = (aimed: Aim): string => {
  const o = aimed.pick?.option;
  return o ? JSON.stringify([o.id, o.label, o.value]) : "";
};

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Whether an approval still covers what is on the page now: same tab, document, snapshot, address, arguments, the
 * very same elements (by identity, not by description: two identical "Delete" buttons are two elements) and the
 * same description of them.
 */
function stillCovers(rec: NonNullable<Awaited<ReturnType<typeof takeApproval>>>, tab: Tab, a: ActArgs, aimed: Aim): boolean {
  return (
    rec.tabId === tab.id &&
    rec.docNonce === (aimed.doc?.nonce ?? "") &&
    rec.generation === (aimed.doc?.generation ?? -1) &&
    rec.href === (aimed.doc?.href ?? "") &&
    rec.args === canonicalArgs(a) &&
    sameList(rec.elementIds, aimed.ids) &&
    rec.option === optionKey(aimed) &&
    sameList(rec.facts, aimed.targets.map(factsKey))
  );
}

/** act and act_with_approval. `approved` is true only for act_with_approval, which must carry the approval_id of an earlier needs_approval. */
export async function act(a: ActArgs, approved: boolean, isCurrent: IsCurrent = () => true): Promise<CommandOutput> {
  requireArgs(a);
  const tab = await getWorkableTab();
  const live: Live = () => ensureCurrent(isCurrent);
  const aimed = await aim(tab, a, live);
  await cursor.busy(tab);
  const action = riskAction(a);

  // Judge without any approval first: an approval never decides this, the record below does.
  const risk: Risk = aimed.unresolved
    ? { level: "blocked", reason: "Blocked: Hermes cannot tell which element has keyboard focus, so it will not press keys. Click a field from the snapshot first." }
    : classifyTargets(action, aimed.targets, false);
  if (risk.level === "blocked") {
    if (approved) await takeApproval(a.approval_id);
    return { status: "blocked", text: risk.reason };
  }
  if (a.action === "select") requireOption(a, aimed);  // nothing to ask about or to do when no option can be resolved
  if (aimed.offTarget && risk.level === "safe") {
    throw new CommandError(`Element ${a.ref} cannot take keyboard focus, so the key would go elsewhere (${describe(aimed.facts)}). Click an element that takes keys, then take a new snapshot.`);
  }

  if (risk.level === "needs_approval") {
    if (!approved) return askApproval(tab, a, aimed, "", risk);
    const rec = await takeApproval(a.approval_id);
    if (!rec) {
      return askApproval(tab, a, aimed, "That approval_id is unknown, expired or already used, so nothing was done. ", risk);
    }
    if (!stillCovers(rec, tab, a, aimed)) {
      return askApproval(tab, a, aimed, "The page or the arguments changed since the owner was asked, so nothing was done. Ask the owner again with this new id. ", risk);
    }
  } else if (approved) {
    await takeApproval(a.approval_id);
    throw new CommandError("This action no longer needs approval (the page changed). Call act instead of act_with_approval.");
  }

  const stopWatching = watchNewTabs();
  const done = await perform(tab, a, aimed, live);
  if (done.status === "blocked") {
    stopWatching();
    return done;
  }
  await settle(tab.id);
  const opened = stopWatching();
  const newTabs = opened.map((t) => ` A new tab opened: [tab ${t.id}]. Use use_tab with tab_id ${t.id} to work in it.`).join("");
  return { status: "done", text: `${done.text}${newTabs} ${await pageLine(tab.id)}` };
}
