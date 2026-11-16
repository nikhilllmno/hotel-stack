import type { CommandName, ResultMessage } from "../../shared/protocol";

/** What a command hands back; the dispatcher turns it into a ResultMessage. */
export type CommandOutput = { text: string; status?: ResultMessage["status"]; image?: ResultMessage["image"] };

export type Handler = (args: Record<string, unknown>, approved: boolean) => Promise<CommandOutput>;
export type Handlers = Record<CommandName, Handler>;
