/** A failure the agent can act on: the message is a full sentence and goes straight into ResultMessage.error. */
export class CommandError extends Error {}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Whether the bridge connection that sent a command is still the current one. Handlers check it right before they change Chrome. */
export type IsCurrent = () => boolean;

/** Stops a command whose connection was replaced: its remaining changes to Chrome must not happen. */
export function ensureCurrent(isCurrent: IsCurrent): void {
  if (!isCurrent()) throw new CommandError("The bridge connection changed while this command ran, so the rest of it was not done. Check the page, then repeat it if needed.");
}
