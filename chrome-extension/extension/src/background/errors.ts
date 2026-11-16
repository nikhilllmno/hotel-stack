/** A failure the agent can act on: the message is a full sentence and goes straight into ResultMessage.error. */
export class CommandError extends Error {}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
