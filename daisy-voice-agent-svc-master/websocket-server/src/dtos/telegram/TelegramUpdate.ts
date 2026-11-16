/**
 * Telegram Update object interface
 * Based on Telegram Bot API documentation
 */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  message_reaction?: TelegramMessageReaction;
  // Add other update types as needed
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  /** The message that contained the inline keyboard (if applicable) */
  message?: TelegramMessage;
  /** Data associated with the callback button */
  data?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  chat: TelegramChat;
  date: number;
  /**
   * Forum topic id — only set in supergroups with Topics enabled.
   * Required when posting into the same topic as the manager's reply; harmless when omitted.
   */
  message_thread_id?: number;
  text?: string;
  caption?: string; // Caption for photos/videos/documents
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  reply_to_message?: TelegramMessage;
  media_group_id?: string; // ID for grouping multiple media messages (albums)
  // Add other message fields as needed
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramReactionType {
  type: 'emoji' | 'custom_emoji' | 'paid';
  emoji?: string; // present when type is "emoji"
  custom_emoji_id?: string; // present when type is "custom_emoji"
}

/**
 * Represents a reaction change on a message.
 * Sent when a user adds or removes a reaction.
 */
export interface TelegramMessageReaction {
  chat: TelegramChat;
  message_id: number;
  user?: TelegramUser;
  date: number;
  old_reaction: TelegramReactionType[];
  new_reaction: TelegramReactionType[];
}
