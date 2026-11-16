import { Hotel } from '../../models/Hotel';
import { ChatOutboundMessageRepository } from '../../repositories/ChatOutboundMessageRepository';
import { HotelRepository } from '../../repositories/HotelRepository';
import { TeamsConversationReferenceRepository } from '../../repositories/TeamsConversationReferenceRepository';
import { KpiStat } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import {
  ChatInteractionService,
  ManagerReplyConfirmation,
} from '../chat/chatInteractionService';
import {
  extractGuestPhoneFromTranscriptText,
  looksLikeTranscriptText,
  parseHandbackCallbackData,
} from '../chat/chatMessageParsing';
import escalationService from '../escalation/escalationService';
import { hotelConfigurationService } from '../hotelConfiguration/hotelConfigurationService';
import { notificationFactory } from '../notification/notificationFactory';
import { NotificationType } from '../notification/notificationType';
import { TEAMS_ACTION_KEY } from '../notification/teamsFormatting';
import {
  normalizeTeamsChannelId,
  parseTeamsThreadId,
  TEAMS_PROVIDER,
  TeamsNotificationService,
} from '../notification/teamsNotificationService';
import { NotificationChatContent } from '../notification/types';
import {
  isManagerReplyConfirmCallback,
  parseManagerReplyConfirmation,
} from '../telegram/managerReplyConfirmationFormat';
import { logTeamsKpi } from './teamsKpi';

/** Reaction names Teams sends, mapped to the emojis hotels list in `allowed_emojis`. */
const TEAMS_REACTION_EMOJIS: Record<string, string[]> = {
  like: ['👍'],
  heart: ['❤️', '❤'],
  laugh: ['😆', '😂'],
  surprised: ['😮'],
  sad: ['🙁', '😢'],
  angry: ['😠'],
};

export interface TeamsInboundActivity {
  type?: string;
  id?: string;
  text?: string;
  value?: unknown;
  replyToId?: string;
  serviceUrl?: string;
  from?: { id?: string; name?: string };
  recipient?: { id?: string };
  conversation?: {
    id?: string;
    conversationType?: string;
    tenantId?: string;
  };
  channelData?: unknown;
  membersAdded?: Array<{ id?: string }>;
  reactionsAdded?: Array<{ type?: string }>;
  action?: string;
}

interface TeamsChannelData {
  tenant?: { id?: string };
  team?: { id?: string };
  channel?: { id?: string };
}

type TeamsChat = Pick<TeamsNotificationService, 'sendMessage' | 'editMessage'>;

/**
 * Handles what Bot Framework delivers for the Daisy Teams bot: installs, replies
 * in escalation / transcript channels, reactions and button clicks. The JWT is
 * validated by the SDK adapter before this runs.
 */
export class TeamsWebhookService {
  constructor(
    private hotelRepository: HotelRepository,
    private chatInteractionService: ChatInteractionService,
    private references: TeamsConversationReferenceRepository,
    private outboundMessages: ChatOutboundMessageRepository,
    private getTeamsChat: () => TeamsChat,
  ) {}

  public async handleActivity(activity: TeamsInboundActivity): Promise<void> {
    const channelData = (activity.channelData ?? {}) as TeamsChannelData;
    const channelId = this.resolveChannelId(activity, channelData);
    if (!channelId) {
      return;
    }

    const isInstallationUpdate =
      activity.type === 'installationUpdate' && activity.action === 'add';
    const isBotAdded =
      activity.type === 'conversationUpdate' &&
      activity.membersAdded?.some((m) => m.id === activity.recipient?.id);
    const isInstall = isInstallationUpdate || isBotAdded;

    if (
      activity.type === 'message' ||
      activity.type === 'messageReaction' ||
      isInstall
    ) {
      if (!(await this.rememberChannel(activity, channelData, channelId))) {
        return;
      }
      if (activity.type === 'message') {
        await logTeamsKpi({
          stat: KpiStat.TeamsMessageReceived,
          contextName: 'TeamsWebhookService.handleActivity',
          channelId,
          hotels: this.hotelRepository,
        });
      }
    }

    if (isInstall) {
      // Teams sends both installationUpdate and conversationUpdate when the bot
      // is added; welcoming on both posts the message twice.
      if (isInstallationUpdate) {
        await this.sendInstallWelcome(channelId);
      }
      return;
    }

    if (activity.conversation?.conversationType !== 'channel') {
      return;
    }

    if (activity.type === 'messageReaction') {
      await this.handleReaction(activity, channelId);
    } else if (activity.type === 'message') {
      await this.handleMessage(activity, channelId);
    }
  }

  private resolveChannelId(
    activity: TeamsInboundActivity,
    channelData: TeamsChannelData,
  ): string | null {
    const raw = channelData.channel?.id ?? activity.conversation?.id;
    return raw ? normalizeTeamsChannelId(raw) : null;
  }

  /**
   * Keeps the channel's service URL fresh and rejects activity from a tenant
   * other than the one the channel was first seen in.
   * @returns false when the activity must be ignored
   */
  private async rememberChannel(
    activity: TeamsInboundActivity,
    channelData: TeamsChannelData,
    channelId: string,
  ): Promise<boolean> {
    const tenantId = channelData.tenant?.id ?? activity.conversation?.tenantId;
    if (!tenantId || !activity.serviceUrl || !activity.recipient?.id) {
      logger.warn(
        `TeamsWebhookService: Activity for channel ${channelId} is missing tenant, service URL or bot id`,
      );
      return false;
    }

    const known = await this.references.findByChannelId(channelId);
    if (known && known.tenant_id !== tenantId) {
      logger.warn(
        `TeamsWebhookService: Tenant ${tenantId} does not match the tenant registered for channel ${channelId} — ignoring`,
      );
      return false;
    }

    await this.references.upsert({
      channel_id: channelId,
      tenant_id: tenantId,
      service_url: activity.serviceUrl,
      team_id: channelData.team?.id ?? null,
      bot_id: activity.recipient.id,
    });
    return true;
  }

  private async sendInstallWelcome(channelId: string): Promise<void> {
    await this.getTeamsChat().sendMessage({
      recipient: channelId,
      content: {
        message:
          'Dextr is installed. The channel ID is:\n' +
          `${channelId}\n\n` +
          'To use another channel, mention Dextr there and write "link".',
      },
    });
  }

  private async handleMessage(
    activity: TeamsInboundActivity,
    channelId: string,
  ): Promise<void> {
    const action = this.readAction(activity.value);
    if (action) {
      await this.handleAction(activity, channelId, action);
      return;
    }

    const text = this.cleanText(activity.text);
    const rootId = this.resolveRootMessageId(activity);

    if (!rootId) {
      if (text.toLowerCase() === 'link') {
        await this.getTeamsChat().sendMessage({
          recipient: channelId,
          content: {
            message: `This channel has been registered with Dextr.\n\nTo use another channel, mention Dextr there and write "link".\n\nChannel ID: ${channelId}`,
            replyToMessageId: activity.id,
          },
        });
      }
      return;
    }

    if (!text) {
      logger.info('TeamsWebhookService: Empty reply — ignoring');
      return;
    }

    const checkInHotel =
      await this.hotelRepository.findByTelegramCheckInGroupId(channelId);
    if (checkInHotel) {
      await this.handleEscalationReply(checkInHotel, channelId, rootId, text);
      return;
    }

    const transcriptHotel =
      await this.hotelRepository.findByTelegramTranscriptGroupId(channelId);
    if (transcriptHotel) {
      await this.handleTranscriptReply(
        transcriptHotel,
        channelId,
        rootId,
        text,
      );
      return;
    }

    logger.info(
      `TeamsWebhookService: Channel ${channelId} is not a configured check-in or transcript channel`,
    );
  }

  private async handleEscalationReply(
    hotel: Hotel,
    channelId: string,
    rootId: string,
    managerResponse: string,
  ): Promise<void> {
    const original = await this.outboundMessages.find(
      TEAMS_PROVIDER,
      channelId,
      rootId,
    );
    if (!original) {
      logger.info(
        `TeamsWebhookService: Reply to ${rootId} is not to a message Daisy posted — ignoring`,
      );
      return;
    }
    const extractedPhone = extractGuestPhoneFromTranscriptText(original.text);
    if (!extractedPhone) {
      logger.error(
        `TeamsWebhookService: No phone number found in message ${rootId}`,
      );
      return;
    }

    await this.chatInteractionService.handleEscalationReply({
      hotel,
      extractedPhone,
      managerResponse,
    });
  }

  private async handleTranscriptReply(
    hotel: Hotel,
    channelId: string,
    rootId: string,
    replyText: string,
  ): Promise<void> {
    if (!(await this.chatInteractionService.isManagerBargeInEnabled(hotel))) {
      logger.info(
        `TeamsWebhookService: Manager barge-in not enabled for hotel ${hotel.id} — ignoring reply`,
      );
      return;
    }

    const original = await this.outboundMessages.find(
      TEAMS_PROVIDER,
      channelId,
      rootId,
    );
    if (!original || !looksLikeTranscriptText(original.text)) {
      logger.info(
        'TeamsWebhookService: Reply is not to a Daisy transcript message — ignoring',
      );
      return;
    }
    const guestPhone = extractGuestPhoneFromTranscriptText(original.text);
    if (!guestPhone) {
      logger.error(
        `TeamsWebhookService: No guest phone in transcript message ${rootId}`,
      );
      return;
    }

    const confirmation: ManagerReplyConfirmation =
      await this.chatInteractionService.buildManagerReplyConfirmation({
        hotel,
        guestPhone,
        replyText,
      });

    await this.getTeamsChat().sendMessage({
      recipient: channelId,
      content: {
        message: confirmation.message,
        actions: confirmation.actions,
        replyToMessageId: rootId,
      },
    });
  }

  private async handleReaction(
    activity: TeamsInboundActivity,
    channelId: string,
  ): Promise<void> {
    if (!activity.replyToId) {
      return;
    }
    const hotel =
      await this.hotelRepository.findByTelegramCheckInGroupId(channelId);
    if (!hotel) {
      logger.warn(
        `TeamsWebhookService: No hotel found for Teams channel ${channelId}`,
      );
      return;
    }

    const addedEmojis = (activity.reactionsAdded ?? []).flatMap((reaction) => {
      const type = reaction.type ?? '';
      return TEAMS_REACTION_EMOJIS[type] ?? [type];
    });

    await this.chatInteractionService.handleEscalationReaction({
      hotel,
      externalMessageId: activity.replyToId,
      addedEmojis,
      user: activity.from?.name ?? 'unknown',
    });
  }

  /** A button click: Teams sends it as a message whose `value` holds the action. */
  private async handleAction(
    activity: TeamsInboundActivity,
    channelId: string,
    data: string,
  ): Promise<void> {
    const clickedMessageId = activity.replyToId;
    logger.info(`TeamsWebhookService: Received action: ${data}`);

    if (data.startsWith('handback:') || data.startsWith('resume_ai:')) {
      const phones = parseHandbackCallbackData(data);
      if (!phones) {
        logger.error(`TeamsWebhookService: Malformed action data: ${data}`);
        return;
      }
      const hotelFromChat =
        await this.hotelRepository.findByTelegramTranscriptGroupId(channelId);
      if (data.startsWith('handback:')) {
        await this.chatInteractionService.handleHandback({
          hotelFromChat,
          ...phones,
        });
        return;
      }
      const switched = await this.chatInteractionService.handleResumeAi({
        hotelFromChat,
        ...phones,
      });
      if (switched && clickedMessageId) {
        await this.updateClickedMessage(
          activity,
          clickedMessageId,
          this.chatInteractionService.resumeAiUi().text,
        );
      }
      return;
    }

    if (isManagerReplyConfirmCallback(data)) {
      await this.handleManagerReplyConfirm(
        activity,
        channelId,
        clickedMessageId,
        data,
      );
      return;
    }

    logger.warn(`TeamsWebhookService: Unknown action data: ${data}`);
  }

  private async handleManagerReplyConfirm(
    activity: TeamsInboundActivity,
    channelId: string,
    clickedMessageId: string | undefined,
    action: Parameters<ChatInteractionService['sendManagerReply']>[0]['action'],
  ): Promise<void> {
    const stored = clickedMessageId
      ? await this.outboundMessages.find(
          TEAMS_PROVIDER,
          channelId,
          clickedMessageId,
        )
      : null;
    const parsed = stored ? parseManagerReplyConfirmation(stored.text) : null;
    if (!clickedMessageId || !parsed) {
      logger.warn(
        'TeamsWebhookService: Could not read the confirmation message for this action',
      );
      if (clickedMessageId) {
        await this.updateClickedMessage(
          activity,
          clickedMessageId,
          '⚠️ Could not read this confirmation. Reply to the transcript message again.',
        );
      }
      return;
    }

    const hotel =
      await this.hotelRepository.findByTelegramTranscriptGroupId(channelId);
    if (!hotel) {
      logger.error(
        `TeamsWebhookService: No hotel for transcript channel ${channelId}`,
      );
      return;
    }

    try {
      await this.chatInteractionService.sendManagerReply({
        hotel,
        guestPhone: parsed.guestPhone,
        replyText: parsed.replyText,
        action,
      });
    } catch (error) {
      await this.updateClickedMessage(
        activity,
        clickedMessageId,
        `❌ Failed to send: ${(error as Error).message}`,
      );
      throw error;
    }

    try {
      const ui = await this.chatInteractionService.buildManagerReplySentUi({
        hotel,
        guestPhone: parsed.guestPhone,
        action,
      });
      await this.updateClickedMessage(
        activity,
        clickedMessageId,
        ui.text,
        ui.actions,
      );
    } catch (uiError) {
      logger.error(
        `TeamsWebhookService: SMS sent but failed to update Teams UI: ${(uiError as Error).message}`,
      );
    }
  }

  private async updateClickedMessage(
    activity: TeamsInboundActivity,
    messageId: string,
    text: string,
    actions?: NotificationChatContent['actions'],
  ): Promise<void> {
    try {
      await this.getTeamsChat().editMessage(
        activity.conversation?.id ?? '',
        messageId,
        { message: text, actions },
      );
    } catch (error) {
      logger.warn(
        `TeamsWebhookService: Failed to update message ${messageId}: ${(error as Error).message}`,
      );
    }
  }

  private readAction(value: unknown): string | null {
    if (value && typeof value === 'object') {
      const action = (value as Record<string, unknown>)[TEAMS_ACTION_KEY];
      return typeof action === 'string' ? action : null;
    }
    return null;
  }

  /** Message id of the thread a message was written in; undefined for new top-level posts. */
  private resolveRootMessageId(
    activity: TeamsInboundActivity,
  ): string | undefined {
    const threadId = parseTeamsThreadId(activity.conversation?.id ?? '');
    // Teams stamps a new top-level post's own id into conversation.id, so a
    // thread id equal to the activity id means the post is not a reply.
    if (threadId && threadId !== activity.id) {
      return threadId;
    }
    return activity.replyToId;
  }

  private cleanText(text: string | undefined): string {
    return (text ?? '')
      .replace(/<at>.*?<\/at>/gi, '')
      .replace(/&nbsp;/g, ' ')
      .trim();
  }
}

let singleton: TeamsWebhookService | undefined;

export function getTeamsWebhookService(): TeamsWebhookService {
  singleton ??= new TeamsWebhookService(
    new HotelRepository(),
    new ChatInteractionService(
      new HotelRepository(),
      hotelConfigurationService,
      escalationService,
    ),
    new TeamsConversationReferenceRepository(),
    new ChatOutboundMessageRepository(),
    () =>
      notificationFactory.createNotificationService(
        NotificationType.TEAMS,
      ) as TeamsNotificationService,
  );
  return singleton;
}
