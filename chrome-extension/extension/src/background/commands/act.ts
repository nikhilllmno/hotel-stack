import type { ActArgs } from "../../shared/protocol";
import { getWorkableTab, type Tab } from "../agent-tab";
import { CommandError } from "../errors";
import { insertText, mouseClick, mouseMove, pressKey, visualViewport, wheel } from "../input";
import { parseKey } from "../keys";
import { callPage } from "../page-call";
import { classifyAction, type ElementFacts, type RiskAction } from "../risk";
import { settle } from "../tab-load";
import { pageLine } from "./page-line";
import type { CommandOutput } from "./types";

type Aim = { facts: ElementFacts; point?: { x: number; y: number } };

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
  if (a.action === "press") needs(!!a.key, "key, for example Enter, Tab, Escape, ArrowDown or Control+A");
  if (a.action === "scroll") needs(!!a.direction, "direction: up, down, left or right");
}

/** Scroll the target into view and read what is there; without a target (press, scroll) it is the focused element. */
async function aim(tab: Tab, a: ActArgs): Promise<Aim> {
  if (a.ref === undefined && (a.x === undefined || a.y === undefined)) {
    return { facts: await callPage(tab, { op: "active" }) };
  }
  const found = await callPage(tab, { op: "locate", ref: a.ref, x: a.x, y: a.y });
  if (!found.found) {
    throw found.reason === "gone" ? staleRef(a.ref ?? "") : new CommandError(`Nothing is at (${a.x}, ${a.y}) in the viewport. Take a screenshot to find the right position.`);
  }
  if (found.covered) {
    throw new CommandError(`Element ${a.ref} is covered by "${found.covered}". Close or dismiss that first, then take a new snapshot.`);
  }
  return { facts: found.facts, point: { x: found.x, y: found.y } };
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

async function typeInto(tab: Tab, a: ActArgs, aimed: Aim): Promise<string> {
  const { facts } = aimed;
  if (!facts.editable) {
    throw new CommandError(`${describe(facts)} is not a text field, so nothing can be typed into it. Pick a textbox from the snapshot.`);
  }
  const clear = a.clear !== false;
  if (a.ref !== undefined) {
    const focused = await callPage(tab, { op: "focus", ref: a.ref, clear });
    if (!focused.found) throw staleRef(a.ref);
    if (clear && focused.hadText) await pressKey(tab, "Backspace");
  } else if (aimed.point) {
    await mouseClick(tab, aimed.point.x, aimed.point.y);
    if (clear) {
      await pressKey(tab, "Control+A");
      await pressKey(tab, "Backspace");
    }
  }
  await insertText(tab, a.text ?? "");
  return `Typed ${(a.text ?? "").length} characters into ${describe(facts)}.`;
}

async function selectOption(tab: Tab, a: ActArgs, facts: ElementFacts): Promise<string> {
  const ref = a.ref ?? "";
  const picked = await callPage(tab, { op: "select", ref, text: a.text ?? "" });
  if (!picked.found) throw staleRef(ref);
  if (!picked.native) {
    throw new CommandError(`${describe(facts)} is not a native dropdown. Click it, then click the option you want.`);
  }
  if (picked.label === undefined) {
    throw new CommandError(`${describe(facts)} has no option "${a.text}". Options: ${picked.options.join(", ")}.`);
  }
  return `Selected "${picked.label}" in ${describe(facts)}.`;
}

async function scroll(tab: Tab, a: ActArgs, aimed: Aim): Promise<string> {
  const v = await visualViewport(tab);
  const horizontal = a.direction === "left" || a.direction === "right";
  const amount = a.amount ?? (horizontal ? v.clientWidth : v.clientHeight);
  const sign = a.direction === "up" || a.direction === "left" ? -1 : 1;
  const at = aimed.point ?? { x: v.clientWidth / 2, y: v.clientHeight / 2 };
  await wheel(tab, at.x, at.y, horizontal ? sign * amount : 0, horizontal ? 0 : sign * amount);
  return `Scrolled ${a.direction} ${amount} px.`;
}

async function perform(tab: Tab, a: ActArgs, aimed: Aim): Promise<string> {
  const { facts, point } = aimed;
  switch (a.action) {
    case "click":
      await mouseClick(tab, point!.x, point!.y);
      return `Clicked ${describe(facts)}.`;
    case "hover":
      await mouseMove(tab, point!.x, point!.y);
      return `Hovered over ${describe(facts)}.`;
    case "type":
      return typeInto(tab, a, aimed);
    case "press":
      if (a.ref !== undefined) await callPage(tab, { op: "focus", ref: a.ref, clear: false });
      await pressKey(tab, a.key ?? "");
      return `Pressed ${a.key}${a.ref ? ` on ${describe(facts)}` : ""}.`;
    case "select":
      return selectOption(tab, a, facts);
    case "scroll":
      return scroll(tab, a, aimed);
  }
}

/** act and act_with_approval. `approved` is true only when the owner approved this exact call in Hermes. */
export async function act(a: ActArgs, approved: boolean): Promise<CommandOutput> {
  requireArgs(a);
  const tab = await getWorkableTab();
  const aimed = await aim(tab, a);
  const risk = classifyAction(riskAction(a), aimed.facts, approved);
  if (risk.level === "blocked") return { status: "blocked", text: risk.reason };
  if (risk.level === "needs_approval") {
    return {
      status: "needs_approval",
      text:
        `Not done: this ${ACTION_WORDS[a.action]} needs the owner's approval (${risk.reason}: "${risk.name}"). ` +
        "Call act_with_approval with the same arguments and a short reason.",
    };
  }
  const stopWatching = watchNewTabs();
  const done = await perform(tab, a, aimed);
  await settle(tab.id);
  const opened = stopWatching();
  const newTabs = opened.map((t) => ` A new tab opened: [tab ${t.id}]. Use use_tab with tab_id ${t.id} to work in it.`).join("");
  return { status: "done", text: `${done}${newTabs} ${await pageLine(tab.id)}` };
}
