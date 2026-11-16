/**
 * Available notification channel types
 */
export enum NotificationType {
  TELEGRAM = 'telegram',
  EMAIL = 'email',
  SMS = 'sms',
  TEAMS = 'teams',
}

/**
 * Chat providers a hotel can be switched to via `hotels.notification_type`.
 */
export type ChatNotificationType =
  | NotificationType.TELEGRAM
  | NotificationType.TEAMS;

export const CHAT_NOTIFICATION_TYPES: ChatNotificationType[] = [
  NotificationType.TELEGRAM,
  NotificationType.TEAMS,
];
