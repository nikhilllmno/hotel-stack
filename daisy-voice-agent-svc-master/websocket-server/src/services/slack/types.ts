/**
 * Shape of a Slack incoming-webhook payload.
 *
 * `text` is the only required field for a plain message. `blocks` / `attachments`
 * are optional and let callers build richer Block Kit messages without changing
 * the service. Kept loose (`unknown[]`) so we don't have to model the whole
 * Block Kit schema — extend with concrete types if/when we need stricter typing.
 *
 * @see https://api.slack.com/messaging/webhooks
 * @see https://api.slack.com/reference/messaging/payload
 */
export interface SlackMessagePayload {
  text: string;
  blocks?: unknown[];
  attachments?: unknown[];
  /** Override the channel configured on the webhook (only works for legacy webhooks). */
  channel?: string;
  /** Override the display name the message is posted as. */
  username?: string;
  /** Emoji (e.g. ":robot_face:") used as the message icon. */
  icon_emoji?: string;
  /** Image URL used as the message icon. */
  icon_url?: string;
  /** Enable/disable Slack markdown parsing. Defaults to enabled on Slack's side. */
  mrkdwn?: boolean;
}

/** A message can be given either as a plain string or a full payload. */
export type SlackMessageInput = string | SlackMessagePayload;

export interface SlackServiceOptions {
  /** Incoming-webhook URL. Defaults to `config.SLACK_WEBHOOK_URL`. */
  webhookUrl?: string;
  /** Request timeout in milliseconds. Defaults to 60s (`SLACK_TIMEOUT_MS`). */
  timeoutMs?: number;
}

/** Result of sending a single message in a batch. */
export interface SlackSendResult {
  success: boolean;
  /** Present when `success` is false. */
  error?: string;
}
