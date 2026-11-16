jest.mock('@/services/notification/telegramNotificationService', () => ({
  TelegramNotificationService: jest.fn().mockImplementation(() => ({
    kind: 'telegram',
  })),
}));
jest.mock('@/services/notification/teamsNotificationService', () => ({
  TeamsNotificationService: jest.fn().mockImplementation(() => ({
    kind: 'teams',
  })),
}));

import { NotificationFactory } from '@/services/notification/notificationFactory';
import { NotificationType } from '@/services/notification/notificationType';
import { TeamsNotificationService } from '@/services/notification/teamsNotificationService';

describe('NotificationFactory.getChatService', () => {
  const factory = NotificationFactory.getInstance();

  it('uses Telegram when the hotel has no notification type', () => {
    expect(factory.getChatService(undefined)).toMatchObject({
      kind: 'telegram',
    });
    expect(factory.getChatService(null)).toMatchObject({ kind: 'telegram' });
  });

  it('routes by the hotel notification type', () => {
    expect(factory.getChatService(NotificationType.TELEGRAM)).toMatchObject({
      kind: 'telegram',
    });
    expect(factory.getChatService(NotificationType.TEAMS)).toMatchObject({
      kind: 'teams',
    });
  });

  it('creates each provider once', () => {
    expect(factory.getChatService(NotificationType.TEAMS)).toBe(
      factory.getChatService(NotificationType.TEAMS),
    );
    expect(TeamsNotificationService).toHaveBeenCalledTimes(1);
  });
});
