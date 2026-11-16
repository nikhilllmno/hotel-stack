// src/services/notification/types.ts

import { TwilioConfiguration } from '../../types/hotelConfiguration';
import { SlackMessageInput } from '../slack/types';

/**
 * Base interface for notification message payloads
 */
export interface NotificationPayload {
  recipient: string;
  content: NotificationContent;
}

/** A button shown under a chat message. `data` is returned when it is clicked. */
export interface ChatAction {
  text: string;
  data: string;
}

/**
 * Provider-neutral content for hotel chat messages (Telegram, Teams, ...).
 * `parseMode` declares how `message` is formatted; each adapter converts it to
 * what its provider renders.
 */
export interface NotificationChatContent {
  message: string;
  parseMode?: 'HTML' | 'MarkdownV2';
  /** Button rows rendered under the message */
  actions?: ChatAction[][];
  /** Posts the message as a reply to (a thread under) this message */
  replyToMessageId?: string | number;
  /** Telegram forum topic id — ignored by other providers */
  messageThreadId?: number;
}

export type NotificationTelegramContent = NotificationChatContent;

/**
 * Content structure for Email messages
 */
export interface NotificationEmailContent {
  subject: string;
  message: string;
  cc?: string[];
  bcc?: string[];
  senderName?: string;
}

/**
 * Content structure for SMS messages
 */
export interface NotificationSMSContent {
  from: string;
  message: string;
  mediaUrl?: string[];
  twilioConfiguration?: TwilioConfiguration | null;
}

/**
 * Content structure for Slack messages
 */
export interface NotificationSlackContent {
  /** Plain text, or a full Slack payload (Block Kit, overrides, …). */
  message: SlackMessageInput;
}

/**
 * Union type of all possible notification content types
 */
export type NotificationContent =
  | NotificationChatContent
  | NotificationEmailContent
  | NotificationSMSContent
  | NotificationSlackContent;
