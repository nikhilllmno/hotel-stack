import { Activity } from '@microsoft/agents-activity';
import config from '../../config';
import { TeamsError } from '../../errors/TeamsError';
import { ChatOutboundMessageRepository } from '../../repositories/ChatOutboundMessageRepository';
import { HotelRepository } from '../../repositories/HotelRepository';
import { TeamsConversationReferenceRepository } from '../../repositories/TeamsConversationReferenceRepository';
import { KpiStat, KpiStatValue } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import {
  SdkTeamsConnectorProvider,
  TEAMS_CHANNEL_ID,
  TeamsConnectorProvider,
} from '../teams/teamsAdapter';
import { logTeamsKpi, TeamsHotelLookup } from '../teams/teamsKpi';
import { NotificationService } from './notificationAbstract';
import {
  buildActionCard,
  toTeamsMarkdown,
  truncateForTeams,
  withParagraphBreaks,
} from './teamsFormatting';
import { NotificationChatContent, NotificationPayload } from './types';

export const TEAMS_PROVIDER = 'teams';

const MAX_SEND_ATTEMPTS = 3;
const DEFAULT_RETRY_AFTER_MS = 1000;
const MAX_RETRY_AFTER_MS = 10000;
const ADAPTIVE_CARD_CONTENT_TYPE = 'application/vnd.microsoft.card.adaptive';

/** `19:abc@thread.tacv2;messageid=123` -> `19:abc@thread.tacv2` */
export function normalizeTeamsChannelId(value: string): string {
  return value.split(';')[0].trim();
}

/** `19:abc@thread.tacv2;messageid=123` -> `123` */
export function parseTeamsThreadId(conversationId: string): string | undefined {
  return conversationId.match(/;messageid=(\d+)/)?.[1];
}

interface TeamsHttpError {
  status?: number;
  response?: { headers?: { get(name: string): string | null } };
}

export interface TeamsNotificationServiceDeps {
  connectors?: TeamsConnectorProvider;
  references?: TeamsConversationReferenceRepository;
  outboundMessages?: ChatOutboundMessageRepository;
  hotels?: TeamsHotelLookup;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * NotificationService for Microsoft Teams channels. `recipient` is the Teams
 * channel id stored in the hotel's telegram_*_group_id columns; the channel must
 * have been seen by the bot (see TeamsWebhookService) so its service URL is known.
 */
export class TeamsNotificationService extends NotificationService {
  private readonly connectors: TeamsConnectorProvider;
  private readonly references: TeamsConversationReferenceRepository;
  private readonly outboundMessages: ChatOutboundMessageRepository;
  private readonly hotels: TeamsHotelLookup;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: TeamsNotificationServiceDeps = {}) {
    super();
    if (!config.TEAMS_BOT_APP_ID) {
      logger.error('Teams bot app id is missing.');
      throw new TeamsError('Teams bot app id is missing.');
    }
    this.connectors = deps.connectors ?? new SdkTeamsConnectorProvider();
    this.references =
      deps.references ?? new TeamsConversationReferenceRepository();
    this.outboundMessages =
      deps.outboundMessages ?? new ChatOutboundMessageRepository();
    this.hotels = deps.hotels ?? new HotelRepository();
    this.sleep =
      deps.sleep ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** @returns the Teams message id, which Teams replies and reactions refer to */
  async sendMessage(payload: NotificationPayload): Promise<string> {
    const content = payload.content as NotificationChatContent;
    const channelId = normalizeTeamsChannelId(payload.recipient);
    const reference = await this.references.findByChannelId(channelId);
    if (!reference) {
      await this.logSendKpi(KpiStat.TeamsMessageSendFailed, channelId);
      throw new TeamsError(
        `Daisy is not installed in Teams channel ${channelId}. Add the app to the team and mention it once in the channel.`,
      );
    }

    const threadConversationId = content.replyToMessageId
      ? `${channelId};messageid=${content.replyToMessageId}`
      : undefined;
    const activity = this.buildActivity(
      content,
      reference.service_url,
      threadConversationId ?? channelId,
    );

    try {
      const messageId = await this.withRetry(() =>
        this.connectors.withConnector(
          {
            serviceUrl: reference.service_url,
            tenantId: reference.tenant_id,
            conversationId: channelId,
          },
          async (connector) => {
            if (threadConversationId) {
              const response = await connector.sendToConversation(
                threadConversationId,
                activity,
              );
              return response.id;
            }
            const response = await connector.createConversation({
              isGroup: true,
              agent: { id: reference.bot_id },
              tenantId: reference.tenant_id,
              channelData: { channel: { id: channelId } },
              activity,
            });
            return response.activityId || parseTeamsThreadId(response.id);
          },
        ),
      );
      if (!messageId) {
        throw new TeamsError('Teams did not return a message id');
      }

      await this.outboundMessages
        .record({
          provider: TEAMS_PROVIDER,
          channel_id: channelId,
          message_id: messageId,
          text: content.message,
        })
        .catch((error: unknown) => {
          logger.warn(
            `TeamsNotificationService: Could not store message ${messageId}: ${(error as Error).message}`,
          );
        });

      logger.info(
        `Teams message sent: channel=${channelId} messageId=${messageId}`,
      );
      await this.logSendKpi(KpiStat.TeamsMessageSent, channelId);
      return messageId;
    } catch (error) {
      await this.logSendKpi(KpiStat.TeamsMessageSendFailed, channelId);
      throw this.toTeamsError('send', error);
    }
  }

  private logSendKpi(stat: KpiStatValue, channelId: string): Promise<void> {
    return logTeamsKpi({
      stat,
      contextName: 'TeamsNotificationService.sendMessage',
      channelId,
      hotels: this.hotels,
    });
  }

  /**
   * Replaces the text (and buttons) of a message sent earlier. `recipient` may be
   * the conversation id of the thread the message sits in (`channel;messageid=root`).
   */
  async editMessage(
    recipient: string,
    messageId: string | number,
    content: NotificationChatContent,
  ): Promise<void> {
    const channelId = normalizeTeamsChannelId(recipient);
    const reference = await this.references.findByChannelId(channelId);
    if (!reference) {
      throw new TeamsError(`Unknown Teams channel ${channelId}`);
    }
    const activity = this.buildActivity(
      content,
      reference.service_url,
      recipient,
    );
    activity.id = String(messageId);

    try {
      await this.withRetry(() =>
        this.connectors.withConnector(
          {
            serviceUrl: reference.service_url,
            tenantId: reference.tenant_id,
            conversationId: channelId,
          },
          (connector) =>
            connector.updateActivity(recipient, String(messageId), activity),
        ),
      );
      await this.outboundMessages
        .record({
          provider: TEAMS_PROVIDER,
          channel_id: channelId,
          message_id: String(messageId),
          text: content.message,
        })
        .catch(() => undefined);
    } catch (error) {
      throw this.toTeamsError('edit', error);
    }
  }

  async deleteMessage(
    recipient: string,
    messageId: string | number,
  ): Promise<void> {
    const channelId = normalizeTeamsChannelId(recipient);
    const reference = await this.references.findByChannelId(channelId);
    if (!reference) {
      throw new TeamsError(`Unknown Teams channel ${channelId}`);
    }
    try {
      await this.withRetry(() =>
        this.connectors.withConnector(
          {
            serviceUrl: reference.service_url,
            tenantId: reference.tenant_id,
            conversationId: channelId,
          },
          (connector) => connector.deleteActivity(recipient, String(messageId)),
        ),
      );
    } catch (error) {
      throw this.toTeamsError('delete', error);
    }
  }

  private buildActivity(
    content: NotificationChatContent,
    serviceUrl: string,
    conversationId: string,
  ): Activity {
    const markdown = truncateForTeams(
      toTeamsMarkdown(content.message, content.parseMode),
    );
    const hasActions = Boolean(content.actions?.length);

    return Activity.fromObject({
      type: 'message',
      channelId: TEAMS_CHANNEL_ID,
      serviceUrl,
      conversation: { id: conversationId },
      ...(hasActions
        ? {
            attachments: [
              {
                contentType: ADAPTIVE_CARD_CONTENT_TYPE,
                content: buildActionCard(markdown, content.actions!),
              },
            ],
          }
        : {
            text: withParagraphBreaks(markdown),
            textFormat: 'markdown',
            attachments: [],
          }),
    });
  }

  /** Teams answers 429 under load; honour Retry-After a few times before giving up. */
  private async withRetry<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await call();
      } catch (error) {
        const httpError = error as TeamsHttpError;
        if (httpError.status !== 429 || attempt >= MAX_SEND_ATTEMPTS) {
          throw error;
        }
        const retryAfterSeconds = Number(
          httpError.response?.headers?.get('retry-after'),
        );
        const delay =
          Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : DEFAULT_RETRY_AFTER_MS;
        logger.warn(
          `TeamsNotificationService: Throttled (429), retrying in ${delay}ms (attempt ${attempt})`,
        );
        await this.sleep(Math.min(delay, MAX_RETRY_AFTER_MS));
      }
    }
  }

  private toTeamsError(operation: string, error: unknown): TeamsError {
    if (error instanceof TeamsError) {
      return error;
    }
    const detail = (error as Error)?.message ?? JSON.stringify(error);
    const message = `Teams API ${operation} error: ${detail}`;
    logger.error(message);
    return new TeamsError(message);
  }
}
