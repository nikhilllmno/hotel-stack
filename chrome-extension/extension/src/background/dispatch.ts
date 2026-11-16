import type { CommandMessage, ResultMessage } from "../shared/protocol";
import { handlers } from "./commands";
import { CommandError, errorMessage, type IsCurrent } from "./errors";
import { getStatus, updateStatus } from "./status";

const SUMMARY_CHARS = 120;

async function publishLastAction(msg: CommandMessage, summary: string, status: NonNullable<ResultMessage["status"]> | "error"): Promise<void> {
  const { agentTabId, agentTabTitle } = await getStatus();
  const tab = agentTabId === undefined ? undefined : await chrome.tabs.get(agentTabId).catch(() => undefined);
  await updateStatus({
    agentTabTitle: tab?.title ?? agentTabTitle,
    lastAction: { name: msg.name, summary: summary.slice(0, SUMMARY_CHARS), status, at: Date.now() },
  });
}

/** Run one bridge command in Chrome and turn the outcome (or failure) into the ResultMessage to send back. */
export async function runCommand(msg: CommandMessage, isCurrent: IsCurrent = () => true): Promise<ResultMessage> {
  try {
    // Only act_with_approval may carry the owner's approval, whatever the message says.
    const handler = handlers[msg.name];
    if (!handler) throw new CommandError(`This extension does not know the command '${msg.name}'. Update the Hermes for Chrome extension.`);
    const out = await handler(msg.args, msg.name === "act_with_approval" && msg.approved, isCurrent);
    const status = out.status ?? "done";
    await publishLastAction(msg, out.text.split("\n")[0], status);
    return { type: "result", id: msg.id, ok: true, status, text: out.text, image: out.image };
  } catch (e) {
    const error = e instanceof CommandError ? e.message : `The Hermes extension failed on '${msg.name}': ${errorMessage(e)}`;
    await publishLastAction(msg, error, "error");
    return { type: "result", id: msg.id, ok: false, error };
  }
}
