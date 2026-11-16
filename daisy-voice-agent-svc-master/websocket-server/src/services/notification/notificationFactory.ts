// src/services/notification/notification.factory.ts

import { EmailNotificationService } from './emailNotificationService';
import { NotificationService } from './notificationAbstract';
import { ChatNotificationType, NotificationType } from './notificationType';
import { SMSNotificationService } from './smsNotificationService';
import { TeamsNotificationService } from './teamsNotificationService';
import { TelegramNotificationService } from './telegramNotificationService';

export { NotificationType } from './notificationType';

/**
 * Factory class for creating notification service instances with proper type safety.
 * Services are created on first use, so a provider whose credentials are missing
 * (for example Teams) cannot break environments that do not use it.
 */
export class NotificationFactory {
  private telegramService?: TelegramNotificationService;
  private teamsService?: TeamsNotificationService;
  private emailService?: EmailNotificationService;
  private smsService?: SMSNotificationService;
  private static instance: NotificationFactory;

  private constructor() {}

  /**
   * Creates and returns a notification service based on the specified type
   * Uses singleton pattern to return the same instance for each service type
   */
  public createNotificationService(
    type: NotificationType,
  ): NotificationService {
    switch (type) {
      case NotificationType.TELEGRAM:
        return (this.telegramService ??= new TelegramNotificationService());

      case NotificationType.TEAMS:
        return (this.teamsService ??= new TeamsNotificationService());

      case NotificationType.EMAIL:
        return (this.emailService ??= new EmailNotificationService());

      case NotificationType.SMS:
        return (this.smsService ??= new SMSNotificationService());

      default:
        throw new Error(`Unsupported notification type: ${type}`);
    }
  }

  /**
   * Returns the chat service a hotel is configured for (`hotels.notification_type`).
   * Hotels without a value use Telegram.
   */
  public getChatService(
    type?: ChatNotificationType | null,
  ): NotificationService {
    return this.createNotificationService(type ?? NotificationType.TELEGRAM);
  }

  /**
   * Returns the singleton instance, creating it if it doesn't exist.
   */
  public static getInstance(): NotificationFactory {
    if (!NotificationFactory.instance) {
      NotificationFactory.instance = new NotificationFactory();
    }
    return NotificationFactory.instance;
  }
}

/** What services depend on, so tests can pass a stub. */
export type ChatServiceResolver = Pick<NotificationFactory, 'getChatService'>;

// Export the singleton instance
export const notificationFactory = NotificationFactory.getInstance();
