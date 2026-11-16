import axios from 'axios';
import { SlackError } from '../../errors/SlackError';
import logger from '../../utils/logger';
import { NotificationService } from '../notification/notificationAbstract';
import {
  NotificationPayload,
  NotificationSlackContent,
} from '../notification/types';
import {
  SlackMessageInput,
  SlackMessagePayload,
  SlackSendResult,
  SlackServiceOptions,
} from './types';

/**
 * Default request timeout for Slack posts. Kept at a full minute (rather than the
 * shorter global API timeout) so a slow webhook never drops a monitoring alert to
 * a premature timeout.
 */
const SLACK_TIMEOUT_MS = 60_000;

/**
 * Thin, reusable client for posting messages to Slack via an
 * [incoming webhook](https://api.slack.com/messaging/webhooks).
 *
 * Extends {@link NotificationService} (like the SMS/Telegram services) so it
 * plugs into the shared notification abstraction. The service is intentionally
 * generic and bot-agnostic so other features can reuse it — each caller supplies
 * its own bot's webhook URL:
 *   - `new SlackService({ webhookUrl }).sendMessage({ recipient: '', content: { message: 'Hello, World!' } })`, or
 *   - pass a full `SlackMessagePayload` as `content.message` for Block Kit messages.
 */
export class SlackService extends NotificationService {
  private readonly webhookUrl: string;
  private readonly timeoutMs: number;

  constructor(options: SlackServiceOptions = {}) {
    super();
    this.webhookUrl = options.webhookUrl ?? '';
    this.timeoutMs = options.timeoutMs ?? SLACK_TIMEOUT_MS;
  }

  /** Whether a webhook URL is available (via constructor or config). */
  isConfigured(): boolean {
    return Boolean(this.webhookUrl);
  }

  /**
   * Send a single message to Slack. Implements {@link NotificationService.sendMessage}.
   *
   * @param payload `recipient` is an optional per-call webhook override (falls
   *   back to the instance/config webhook); `content.message` is plain text or a
   *   full Slack payload (Block Kit, overrides, …).
   * @throws {SlackError} when no webhook is configured or Slack rejects the post.
   */
  async sendMessage(payload: NotificationPayload): Promise<void> {
    const { recipient, content } = payload;
    const { message } = content as NotificationSlackContent;
    await this.post(message, recipient || undefined);
  }

  /**
   * Send many messages, one Slack post per item. Never throws — each item's
   * outcome is returned so a single failure doesn't abort the rest. Messages are
   * sent sequentially to stay well within Slack's incoming-webhook rate limits
   * (~1 message/second per webhook).
   */
  async sendMessages(
    messages: SlackMessageInput[],
    webhookUrl?: string,
  ): Promise<SlackSendResult[]> {
    const results: SlackSendResult[] = [];
    for (const message of messages) {
      try {
        await this.post(message, webhookUrl);
        results.push({ success: true });
      } catch (error) {
        results.push({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  /** Posts a single message to the given (or instance/config) webhook URL. */
  private async post(
    message: SlackMessageInput,
    webhookUrl?: string,
  ): Promise<void> {
    const url = webhookUrl ?? this.webhookUrl;
    if (!url) {
      throw new SlackError(
        'Slack webhook URL is not configured. Pass one to the SlackService constructor or the sendMessage call.',
      );
    }

    const payload = this.normalizePayload(message);

    try {
      await axios.post(url, payload, {
        timeout: this.timeoutMs,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      // Slack returns a non-2xx with a plain-text body (e.g. "invalid_payload",
      // "no_service") on failure — surface it so callers can log/act on it.
      const detail = axios.isAxiosError(error)
        ? (error.response?.data ?? error.message)
        : error instanceof Error
          ? error.message
          : String(error);
      logger.error(`SlackService::post failed: ${JSON.stringify(detail)}`);
      throw new SlackError(`Failed to post message to Slack: ${detail}`);
    }
  }

  private normalizePayload(message: SlackMessageInput): SlackMessagePayload {
    return typeof message === 'string' ? { text: message } : message;
  }
}
