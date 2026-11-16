import config from '../../config';
import {
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramMessageReaction,
  TelegramUpdate,
} from '../../dtos/telegram/TelegramUpdate';
import { TelegramError } from '../../errors/TelegramError';
import { Hotel } from '../../models/Hotel';
import { HotelRepository } from '../../repositories/HotelRepository';
import { createHttpClient } from '../../utils/httpClient';
import logger from '../../utils/logger';
import { ChatInteractionService } from '../chat/chatInteractionService';
import {
  extractGuestPhoneFromTranscriptText,
  looksLikeTranscriptText,
  parseHandbackCallbackData,
} from '../chat/chatMessageParsing';
import escalationService, {
  EscalationService,
} from '../escalation/escalationService';
import {
  hotelConfigurationService,
  HotelConfigurationService,
} from '../hotelConfiguration/hotelConfigurationService';
import telegramNotificationService from '../notification/telegramNotificationService';
import { NotificationChatContent } from '../notification/types';
import {
  isManagerReplyConfirmCallback,
  ManagerReplyConfirmAction,
  parseManagerReplyConfirmation,
} from './managerReplyConfirmationFormat';

const telegramHttpClient = createHttpClient('telegram', {
  timeout: 10000,
});

/**
 * Service to handle Telegram webhook events
 */
export class TelegramWebhookService {
  private webhookSecret: string;
  private hotelRepository: HotelRepository;
  private chatInteractionService: ChatInteractionService;

  constructor(
    webhookSecret: string,
    hotelRepository: HotelRepository,
    hotelConfigurationService: HotelConfigurationService,
    escalationService: EscalationService,
    chatInteractionService?: ChatInteractionService,
  ) {
    this.webhookSecret = webhookSecret;
    this.hotelRepository = hotelRepository;
    this.chatInteractionService =
      chatInteractionService ??
      new ChatInteractionService(
        hotelRepository,
        hotelConfigurationService,
        escalationService,
      );
  }
  /**
   * Validate the webhook secret token
   * @param secretToken - The secret token from the request header
   * @returns true if valid, false otherwise
   */
  public validateSecretToken(secretToken: string | undefined): boolean {
    if (!this.webhookSecret) {
      return false;
    }

    if (!secretToken) {
      logger.warn('Missing X-Telegram-Bot-Api-Secret-Token header');
      return false;
    }

    return secretToken === this.webhookSecret;
  }

  /**
   * Process incoming Telegram webhook update
   * @param update - The Telegram update object
   */
  public async handleWebhookMessage(update: TelegramUpdate): Promise<void> {
    try {
      logger.info(
        `handleWebhookUpdate: Received Telegram update: ${update.update_id}`,
      );

      if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
      } else if (update.message) {
        await this.handleMessage(update.message);
      } else if (update.message_reaction) {
        await this.handleMessageReaction(update.message_reaction);
      } else {
        return;
      }
    } catch (error) {
      const err = error as Error;
      logger.error(
        `handleWebhookUpdate: Error processing Telegram update ${update.update_id}: ${err.message}`,
      );
      throw error;
    }
  }

  /**
   * Handle regular messages
   */
  private async handleMessage(message: TelegramMessage): Promise<void> {
    const channelId = message.chat.id.toString();
    logger.info(
      `handleMessage: Processing message ${message.message_id} from chat ${channelId}`,
    );

    // Check check-in group first (escalation path)
    const checkInHotel =
      await this.hotelRepository.findByTelegramCheckInGroupId(channelId);
    if (checkInHotel) {
      logger.info(
        `handleMessage: Message from check-in hotel: ${checkInHotel.name}`,
      );
      if (message.reply_to_message) {
        await this.handleReplyToBot(message, checkInHotel);
      }
      return;
    }

    // Check transcript group (manager direct reply path)
    const transcriptHotel =
      await this.hotelRepository.findByTelegramTranscriptGroupId(channelId);
    if (transcriptHotel) {
      logger.info(
        `handleMessage: Message from transcript hotel: ${transcriptHotel.name}`,
      );
      if (message.reply_to_message) {
        await this.handleTranscriptGroupReply(message, transcriptHotel);
      } else {
        logger.info(
          `handleMessage: Transcript group message ${message.message_id} is not a reply — ignored`,
        );
      }
      return;
    }

    logger.info(
      `handleMessage: Chat ${channelId} is not a configured check-in or transcript group`,
    );
  }

  /**
   * Handle message_reaction updates.
   * When a manager reacts with an allowed emoji to an escalation notification, marks the escalation as DONE.
   */
  private async handleMessageReaction(
    reaction: TelegramMessageReaction,
  ): Promise<void> {
    const channelId = reaction.chat.id.toString();
    const user =
      reaction.user?.username ?? reaction.user?.first_name ?? 'unknown';

    const addedEmojis = reaction.new_reaction
      .filter((r) => r.type === 'emoji')
      .map((r) => r.emoji);

    logger.info(
      `handleMessageReaction: message_id=${reaction.message_id} chat=${channelId} ` +
        `user=${user} new_reactions=[${addedEmojis.join(', ')}]`,
    );

    const hotel =
      await this.hotelRepository.findByTelegramCheckInGroupId(channelId);
    if (!hotel) {
      logger.warn(
        `handleMessageReaction: No hotel found for channel ID ${channelId}`,
      );
      return;
    }

    await this.chatInteractionService.handleEscalationReaction({
      hotel,
      externalMessageId: reaction.message_id.toString(),
      addedEmojis,
      user,
    });
  }

  /**
   * Handle replies to bot messages
   */
  private async handleReplyToBot(
    message: TelegramMessage,
    hotel: Hotel,
  ): Promise<void> {
    const originalMessage = message.reply_to_message; // original message to which the reply is made
    if (!originalMessage) return;
    const isReplyToBot = originalMessage.from?.is_bot === true;
    if (!isReplyToBot) return;
    const botPrefix = config.TELEGRAM_BOT_TOKEN_PREFIX;
    const eventBotPrefix = originalMessage.from?.id.toString();
    if (eventBotPrefix !== botPrefix) {
      logger.warn(
        `handleReplyToBot: Reply is from bot with prefix ${eventBotPrefix}, which is not the Daisy bot`,
      );
      return;
    }

    // Check if reply has text or image with caption
    const hasText = message.text?.trim();
    const hasImage = message.photo && message.photo.length > 0;
    const hasCaption = message.caption?.trim();

    if (!hasText && !hasImage) {
      logger.info(
        `handleReplyToBot: Empty reply (no text or image) - ignoring`,
      );
      return;
    }

    logger.info(
      `Reply detected: message ${message.message_id} replying to ${originalMessage.message_id}`,
    );
    logger.info(
      `Reply type: ${hasText ? 'text' : ''} ${hasImage ? 'image' : ''} ${hasCaption ? 'with caption' : ''}`,
    );

    try {
      // Extract phone number from original message text
      const originalText = originalMessage.text;
      if (!originalText) {
        logger.error(
          `handleReplyToBot: No text found in original message ${originalMessage.message_id}`,
        );
        return;
      }
      const extractedPhone = extractGuestPhoneFromTranscriptText(originalText);
      if (!extractedPhone) {
        logger.error(
          `handleReplyToBot: No phone number found in original message ${originalMessage.message_id}`,
        );
        return;
      }
      logger.info(
        `handleReplyToBot: Extracted phone number: ${extractedPhone}`,
      );

      const managerResponse = hasImage
        ? hasCaption
          ? message.caption!
          : ''
        : message.text!;

      await this.chatInteractionService.handleEscalationReply({
        hotel,
        extractedPhone,
        managerResponse,
        resolveMediaUrl: hasImage
          ? async () => {
              const photoFileId =
                message.photo![message.photo!.length - 1].file_id; // Get largest photo
              logger.info(
                `handleReplyToBot: Image reply with file_id: ${photoFileId}`,
              );

              const { buffer, extension, contentType } =
                await this.downloadTelegramImage(photoFileId);

              return this.chatInteractionService.uploadEscalationImage(
                buffer,
                extension,
                contentType,
                hotel.id,
              );
            }
          : undefined,
      });
    } catch (error) {
      const err = error as Error;
      logger.error(`handleReplyToBot: Error processing reply: ${err.message}`);
      throw error;
    }
  }

  /**
   * Download image from Telegram
   * @param fileId Telegram file ID
   * @returns Object containing image buffer, extension, and content type
   */
  private async downloadTelegramImage(
    fileId: string,
  ): Promise<{ buffer: Buffer; extension: string; contentType: string }> {
    try {
      // Step 1: Get file path from Telegram
      const getFileUrl = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
      const fileResponse = await telegramHttpClient.get(getFileUrl);

      if (!fileResponse.data.ok) {
        logger.error(
          `downloadTelegramImage: Failed to get file info from Telegram`,
        );
        throw new TelegramError(
          `Failed to get file info from Telegram for file ${getFileUrl}`,
        );
      }

      const filePath = fileResponse.data.result.file_path;
      logger.info(`downloadTelegramImage: Got file path: ${filePath}`);

      // Step 2: Download the image from Telegram
      const downloadUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${filePath}`;
      const imageResponse = await telegramHttpClient.get(downloadUrl, {
        responseType: 'arraybuffer',
      });
      const imageBuffer = Buffer.from(imageResponse.data);

      // Step 3: Determine content type from file extension
      const extension = filePath.split('.').pop()?.toLowerCase() || 'jpg';
      const contentTypeMap: { [key: string]: string } = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
      };
      const contentType = contentTypeMap[extension] || 'image/jpeg';

      logger.info(
        `downloadTelegramImage: Downloaded image with extension: ${extension}`,
      );
      return { buffer: imageBuffer, extension, contentType };
    } catch (error) {
      const err = error as Error;
      logger.error(
        `downloadTelegramImage: Error downloading image: ${err.message}`,
      );
      throw error;
    }
  }

  /**
   * Handle a manager reply inside the Telegram transcript group.
   * Posts a confirmation message with Send / Barge in buttons instead of
   * sending immediately.
   */
  private async handleTranscriptGroupReply(
    message: TelegramMessage,
    hotel: Hotel,
  ): Promise<void> {
    // Feature flag: manager barge-in must be explicitly enabled per hotel
    if (!(await this.chatInteractionService.isManagerBargeInEnabled(hotel))) {
      logger.info(
        `handleTranscriptGroupReply: Manager barge-in not enabled for hotel ${hotel.id} — ignoring reply`,
      );
      return;
    }

    const originalMessage = message.reply_to_message;
    if (!originalMessage) return;

    if (!this.isTranscriptBotMessage(originalMessage)) {
      logger.info(
        `handleTranscriptGroupReply: Reply is not to a Daisy transcript message — ignoring`,
      );
      return;
    }

    const replyText = (message.text ?? message.caption ?? '').trim();
    if (!replyText) {
      logger.info(
        `handleTranscriptGroupReply: Empty reply (no text or caption) — ignoring`,
      );
      return;
    }

    try {
      const extractedPhone =
        this.extractGuestPhoneFromTranscriptMessage(originalMessage);
      if (!extractedPhone) return;

      logger.info(
        `handleTranscriptGroupReply: Extracted phone: ${extractedPhone}`,
      );

      const chatId = message.chat.id.toString();
      const confirmation =
        await this.chatInteractionService.buildManagerReplyConfirmation({
          hotel,
          guestPhone: extractedPhone,
          replyText,
        });

      const threadId = this.resolveForumThreadId(message, originalMessage);

      await this.postManagerReplyConfirmation(chatId, {
        message: confirmation.message,
        actions: confirmation.actions,
        messageThreadId: threadId,
        replyToMessageId: message.message_id,
      });

      logger.info(
        `handleTranscriptGroupReply: Posted confirmation for ${extractedPhone} (threadId=${threadId ?? 'none'})`,
      );
    } catch (error) {
      const err = error as Error;
      logger.error(
        `handleTranscriptGroupReply: Error processing reply: ${err.message}`,
      );
      throw error;
    }
  }

  /**
   * Resolve forum topic id for supergroups with Topics enabled.
   */
  private resolveForumThreadId(
    message: TelegramMessage,
    anchor: TelegramMessage,
  ): number | undefined {
    return message.message_thread_id ?? anchor.message_thread_id;
  }

  /** True when the message is a Daisy transcript posted by our bot. */
  private isTranscriptBotMessage(message: TelegramMessage): boolean {
    const looksLikeTranscript = looksLikeTranscriptText(
      message.text ?? message.caption ?? '',
    );

    if (message.from?.is_bot !== true) {
      return looksLikeTranscript;
    }

    const botPrefix = config.TELEGRAM_BOT_TOKEN_PREFIX;
    if (!botPrefix) {
      return true;
    }
    return message.from.id.toString() === botPrefix;
  }

  /**
   * Post confirmation with fallbacks for forum topics (thread / reply combinations).
   */
  private async postManagerReplyConfirmation(
    chatId: string,
    content: NotificationChatContent,
  ): Promise<void> {
    const variants: NotificationChatContent[] = [
      content,
      { ...content, replyToMessageId: undefined },
      { ...content, messageThreadId: undefined, replyToMessageId: undefined },
      { ...content, messageThreadId: undefined },
    ];

    let lastError: Error | undefined;
    for (let i = 0; i < variants.length; i++) {
      try {
        await telegramNotificationService.sendMessage({
          recipient: chatId,
          content: variants[i],
        });
        if (i > 0) {
          logger.info(
            `postManagerReplyConfirmation: Sent on attempt ${i + 1} for chat ${chatId}`,
          );
        }
        return;
      } catch (error) {
        lastError = error as Error;
        logger.warn(
          `postManagerReplyConfirmation: Attempt ${i + 1} failed for chat ${chatId}: ${lastError.message}`,
        );
      }
    }
    throw (
      lastError ??
      new TelegramError('Failed to post manager reply confirmation')
    );
  }

  /** Extract guest phone from a Danny AI transcript bot message. */
  private extractGuestPhoneFromTranscriptMessage(
    originalMessage: TelegramMessage,
  ): string | null {
    const originalText = originalMessage.text ?? originalMessage.caption;
    if (!originalText) {
      logger.error(
        `extractGuestPhoneFromTranscriptMessage: No text in message ${originalMessage.message_id}`,
      );
      return null;
    }

    const phone = extractGuestPhoneFromTranscriptText(originalText);
    if (!phone) {
      logger.error(
        `extractGuestPhoneFromTranscriptMessage: No phone in message ${originalMessage.message_id}, text preview: ${originalText.slice(0, 200)}`,
      );
      return null;
    }

    return phone;
  }

  /**
   * Handle a Telegram inline keyboard callback_query.
   */
  private async handleCallbackQuery(
    query: TelegramCallbackQuery,
  ): Promise<void> {
    const data = query.data ?? '';
    logger.info(`handleCallbackQuery: Received callback data: ${data}`);

    // Dismiss the loading spinner on the client
    await this.answerCallbackQuery(query.id);

    // "Switch to Danny AI" on a DIRECT-mode transcript
    // → AI routing, manager stepping-out SMS, re-trigger n8n on last guest message
    if (data.startsWith('handback:')) {
      await this.handleHandbackCallback(query, data);
      // "Switch back to Danny AI" on the post–take-control confirmation
      // → AI routing + manager stepping-out SMS only (no n8n re-trigger)
    } else if (data.startsWith('resume_ai:')) {
      await this.handleResumeAiCallback(query, data);
      // Confirm sending the manager's draft from the confirmation message body
    } else if (isManagerReplyConfirmCallback(data)) {
      await this.handleManagerReplyConfirmCallback(query, data);
    } else {
      logger.warn(`handleCallbackQuery: Unknown callback data: ${data}`);
    }
  }

  /** Hotel for the transcript group a button was clicked in (most reliable lookup). */
  private async findHotelFromCallbackChat(
    query: TelegramCallbackQuery,
  ): Promise<Hotel | null> {
    const chatId = query.message?.chat?.id?.toString();
    return chatId
      ? this.hotelRepository.findByTelegramTranscriptGroupId(chatId)
      : null;
  }

  /** "Switch to Danny AI" — set AI routing and re-trigger the n8n handback workflow. */
  private async handleHandbackCallback(
    query: TelegramCallbackQuery,
    data: string,
  ): Promise<void> {
    const phones = parseHandbackCallbackData(data);
    if (!phones) {
      logger.error(`handleHandbackCallback: Malformed handback data: ${data}`);
      return;
    }

    await this.chatInteractionService.handleHandback({
      hotelFromChat: await this.findHotelFromCallbackChat(query),
      guestPhone: phones.guestPhone,
      assistantPhone: phones.assistantPhone,
    });
  }

  /** Confirm and send a manager reply parsed from the confirmation message body. */
  private async handleManagerReplyConfirmCallback(
    query: TelegramCallbackQuery,
    action: ManagerReplyConfirmAction,
  ): Promise<void> {
    const chatId = query.message?.chat?.id?.toString();
    const confirmationText = query.message?.text;

    if (!chatId || !confirmationText) {
      logger.error(
        'handleManagerReplyConfirmCallback: Missing confirmation message text',
      );
      return;
    }

    const parsed = parseManagerReplyConfirmation(confirmationText);
    if (!parsed) {
      logger.warn(
        'handleManagerReplyConfirmCallback: Could not parse confirmation message',
      );
      if (query.message?.message_id) {
        await this.editConfirmationMessage(
          chatId,
          query.message.message_id,
          '⚠️ Could not read this confirmation. Reply to the transcript message again.',
        );
      }
      return;
    }

    const hotel =
      await this.hotelRepository.findByTelegramTranscriptGroupId(chatId);
    if (!hotel) {
      logger.error(
        `handleManagerReplyConfirmCallback: No hotel for transcript group ${chatId}`,
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

      try {
        const ui = await this.chatInteractionService.buildManagerReplySentUi({
          hotel,
          guestPhone: parsed.guestPhone,
          action,
        });
        if (query.message?.message_id) {
          await this.editConfirmationMessage(
            chatId,
            query.message.message_id,
            ui.text,
            ui.actions,
          );
        }
      } catch (uiError) {
        logger.error(
          `handleManagerReplyConfirmCallback: SMS sent but failed to update Telegram UI: ${(uiError as Error).message}`,
        );
      }
    } catch (error) {
      const err = error as Error;
      logger.error(`handleManagerReplyConfirmCallback: Error: ${err.message}`);
      if (query.message?.message_id) {
        await this.editConfirmationMessage(
          chatId,
          query.message.message_id,
          `❌ Failed to send: ${err.message}`,
        );
      }
      throw error;
    }
  }

  /** Switch routing back to AI only — does not re-trigger the n8n handback workflow. */
  private async handleResumeAiCallback(
    query: TelegramCallbackQuery,
    data: string,
  ): Promise<void> {
    const phones = parseHandbackCallbackData(data);
    if (!phones) {
      logger.error(`handleResumeAiCallback: Malformed data: ${data}`);
      return;
    }

    const switched = await this.chatInteractionService.handleResumeAi({
      hotelFromChat: await this.findHotelFromCallbackChat(query),
      guestPhone: phones.guestPhone,
      assistantPhone: phones.assistantPhone,
    });
    if (!switched) {
      return;
    }

    const chatId = query.message?.chat?.id?.toString();
    if (chatId && query.message?.message_id) {
      await this.editConfirmationMessage(
        chatId,
        query.message.message_id,
        this.chatInteractionService.resumeAiUi().text,
      );
    }
  }

  private async editConfirmationMessage(
    chatId: string,
    messageId: number,
    text: string,
    actions?: NotificationChatContent['actions'],
  ): Promise<void> {
    try {
      await telegramNotificationService.editMessage(chatId, messageId, {
        message: text,
        actions,
      });
    } catch (error) {
      logger.warn(
        `editConfirmationMessage: Failed for message ${messageId}: ${(error as Error).message}`,
      );
    }
  }

  /** Answer a Telegram callback_query to dismiss the loading spinner. */
  private async answerCallbackQuery(callbackQueryId: string): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
      await telegramHttpClient.post(url, {
        callback_query_id: callbackQueryId,
      });
    } catch (error) {
      logger.warn(
        `answerCallbackQuery: Failed to answer callback ${callbackQueryId}: ${(error as Error).message}`,
      );
    }
  }
}

// Export singleton instance
export const telegramWebhookService = new TelegramWebhookService(
  config.TELEGRAM_WEBHOOK_SECRET,
  new HotelRepository(),
  hotelConfigurationService,
  escalationService,
);
