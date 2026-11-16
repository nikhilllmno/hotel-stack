// src/services/notification/telegram-notification.service.ts

import axios from 'axios';
import config from '../../config';
import { TelegramError } from '../../errors/TelegramError';
import { createHttpClient } from '../../utils/httpClient';
import logger from '../../utils/logger';
import { NotificationService } from './notificationAbstract';
import {
  ChatAction,
  NotificationChatContent,
  NotificationPayload,
} from './types';

const telegramNotifClient = createHttpClient('telegram-notification', {
  timeout: 5000,
});

export function toTelegramInlineKeyboard(actions: ChatAction[][]): object {
  return {
    inline_keyboard: actions.map((row) =>
      row.map((action) => ({
        text: action.text,
        callback_data: action.data,
      })),
    ),
  };
}

function describeTelegramError(prefix: string, err: unknown): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.description || err.message;
    return `${prefix} (${err.response?.status}): ${detail}`;
  }
  return `Unknown error (${prefix}): ${JSON.stringify(err)}`;
}

/**
 * Implementation of NotificationService for Telegram
 */
export class TelegramNotificationService extends NotificationService {
  private readonly token: string;
  private readonly sendMessageUrl: string;
  private readonly deleteMessageUrl: string;
  private readonly editMessageUrl: string;

  constructor() {
    super(); // Call to parent class constructor

    this.token = config.TELEGRAM_BOT_TOKEN || '';

    if (!this.token) {
      logger.error('Telegram bot token is missing.');
      throw new TelegramError('Telegram bot token is missing.');
    }

    this.sendMessageUrl = `https://api.telegram.org/bot${this.token}/sendMessage`;
    this.deleteMessageUrl = `https://api.telegram.org/bot${this.token}/deleteMessage`;
    this.editMessageUrl = `https://api.telegram.org/bot${this.token}/editMessageText`;
  }

  /**
   * Sends a message via Telegram API.
   */
  async sendMessage(payload: NotificationPayload): Promise<number | void> {
    const content = payload.content as NotificationChatContent;
    try {
      const body: Record<string, unknown> = {
        chat_id: payload.recipient,
        text: content.message,
        parse_mode: content.parseMode,
      };
      if (content.actions?.length) {
        body.reply_markup = JSON.stringify(
          toTelegramInlineKeyboard(content.actions),
        );
      }

      if (content.replyToMessageId) {
        body.reply_parameters = {
          message_id: Number(content.replyToMessageId),
        };
      }
      if (content.messageThreadId) {
        body.message_thread_id = content.messageThreadId;
      }
      const response = await telegramNotifClient.post(
        this.sendMessageUrl,
        body,
      );

      // Get message_id from the response data
      const messageId = response.data?.result?.message_id;
      logger.info(
        `Telegram Message Sent, API Response: ${JSON.stringify(response.data)}`,
      );
      return messageId; // Return the message ID
    } catch (err) {
      const errorMsg = describeTelegramError('Telegram API Error', err);
      logger.error(errorMsg);
      throw new TelegramError(errorMsg);
    }
  }

  /**
   * Replaces the text (and buttons) of a message sent earlier. Omitting
   * `actions` removes any buttons the message had.
   */
  async editMessage(
    recipient: string,
    messageId: string | number,
    content: NotificationChatContent,
  ): Promise<void> {
    try {
      const body: Record<string, unknown> = {
        chat_id: recipient,
        message_id: Number(messageId),
        text: content.message,
      };
      if (content.parseMode) {
        body.parse_mode = content.parseMode;
      }
      if (content.actions?.length) {
        body.reply_markup = JSON.stringify(
          toTelegramInlineKeyboard(content.actions),
        );
      }
      await telegramNotifClient.post(this.editMessageUrl, body);
    } catch (err) {
      const errorMsg = describeTelegramError('Telegram API Edit Error', err);
      logger.error(errorMsg);
      throw new TelegramError(errorMsg);
    }
  }

  public async deleteMessage(
    chatId: string,
    messageId: string | number,
  ): Promise<void> {
    if (!this.token || !chatId || !messageId) {
      logger.error('Missing Telegram token, chatId, or messageId');
      return;
    }

    try {
      const response = await telegramNotifClient.post(this.deleteMessageUrl, {
        chat_id: chatId,
        message_id: Number(messageId),
      });
      logger.info(
        `Telegram Message Deleted, API Response: ${JSON.stringify(response.data)}`,
      );
    } catch (err) {
      const errorMsg = describeTelegramError('Telegram API Delete Error', err);
      logger.error(errorMsg);
      throw new TelegramError(errorMsg);
    }
  }
}

export const telegramNotificationService = new TelegramNotificationService();
export default telegramNotificationService;
