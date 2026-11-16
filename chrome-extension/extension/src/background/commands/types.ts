import type { CommandName, ResultMessage } from "../../shared/protocol";
import type { IsCurrent } from "../errors";

/** What a command hands back; the dispatcher turns it into a ResultMessage. */
export type CommandOutput = { text: string; status?: ResultMessage["status"]; image?: ResultMessage["image"] };

/** `isCurrent` says whether the bridge connection that sent the command is still the current one: check it right before changing Chrome. */
export type Handler = (args: Record<string, unknown>, approved: boolean, isCurrent: IsCurrent) => Promise<CommandOutput>;
export type Handlers = Record<CommandName, Handler>;
