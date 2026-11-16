import { NotificationChatContent, NotificationPayload } from './types';

/**
 * Abstract base class for notification services
 * All notification services must implement the sendMessage method
 */
export abstract class NotificationService {
  /**
   * Sends a message through the notification channel
   * @param payload The notification payload containing recipient and other service-specific data
   * @returns Promise resolving to the message ID or void if sending fails
   */
  abstract sendMessage(
    payload: NotificationPayload,
  ): Promise<number | void | string>;

  /** Chat providers implement this to edit a message they sent earlier. */
  editMessage?(
    recipient: string,
    messageId: string | number,
    content: NotificationChatContent,
  ): Promise<void>;

  /** Chat providers implement this to delete a message they sent earlier. */
  deleteMessage?(recipient: string, messageId: string | number): Promise<void>;
}
