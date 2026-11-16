import { toTelegramInlineKeyboard } from '@/services/notification/telegramNotificationService';

describe('toTelegramInlineKeyboard', () => {
  it('maps neutral actions to Telegram callback buttons, keeping rows', () => {
    expect(
      toTelegramInlineKeyboard([
        [{ text: 'Send', data: 'mgr_send' }],
        [
          { text: 'A', data: 'a' },
          { text: 'B', data: 'b' },
        ],
      ]),
    ).toEqual({
      inline_keyboard: [
        [{ text: 'Send', callback_data: 'mgr_send' }],
        [
          { text: 'A', callback_data: 'a' },
          { text: 'B', callback_data: 'b' },
        ],
      ],
    });
  });
});
