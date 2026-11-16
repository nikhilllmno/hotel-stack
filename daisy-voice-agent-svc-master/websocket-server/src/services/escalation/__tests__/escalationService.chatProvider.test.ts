import { Escalation } from '@/models/Escalations';
import { Hotel } from '@/models/Hotel';
import { EscalationRepository } from '@/repositories/EscalationRepository';
import { EscalationService } from '@/services/escalation/escalationService';
import { HotelService } from '@/services/hotel/hotelService';
import { HotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import { NotificationType } from '@/services/notification/notificationType';
import { SMSNotificationService } from '@/services/notification/smsNotificationService';

const INPUT = {
  message: 'Needs a towel',
  full_name: 'Jane Guest',
  phone_number: '+14155550100',
} as Parameters<EscalationService['handleEscalation']>[0];

function createHarness(hotel: Partial<Hotel>) {
  const escalationRepository = {
    create: jest.fn().mockResolvedValue({ id: 'esc-1' } as Escalation),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const chatService = { sendMessage: jest.fn().mockResolvedValue('1700000') };
  const notificationFactory = {
    getChatService: jest.fn().mockReturnValue(chatService),
  };
  const service = new EscalationService(
    escalationRepository as unknown as EscalationRepository,
    {
      getHotelByAssistantPhoneNumber: jest.fn().mockResolvedValue({
        id: 'hotel-1',
        ...hotel,
      }),
    } as unknown as HotelService,
    notificationFactory,
    {} as SMSNotificationService,
    {} as HotelConfigurationService,
  );
  return { service, escalationRepository, chatService, notificationFactory };
}

describe('EscalationService.handleEscalation chat provider', () => {
  it('sends through the provider of the hotel and stores the message id as a string', async () => {
    const { service, escalationRepository, chatService, notificationFactory } =
      createHarness({
        notification_type: NotificationType.TEAMS,
        telegram_check_in_group_id: '19:abc@thread.tacv2',
      });

    await service.handleEscalation(INPUT, '+15550001111');

    expect(notificationFactory.getChatService).toHaveBeenCalledWith(
      NotificationType.TEAMS,
    );
    expect(chatService.sendMessage).toHaveBeenCalledWith({
      recipient: '19:abc@thread.tacv2',
      content: {
        message: expect.stringContaining('Customer Phone: +14155550100'),
        parseMode: 'HTML',
      },
    });
    expect(escalationRepository.update).toHaveBeenCalledWith('esc-1', {
      external_message_id: '1700000',
    });
  });

  it('defaults to Telegram for hotels without a notification type', async () => {
    const { service, notificationFactory } = createHarness({
      telegram_check_in_group_id: '-100123',
    });

    await service.handleEscalation(INPUT, '+15550001111');

    expect(notificationFactory.getChatService).toHaveBeenCalledWith(undefined);
  });

  it('fails the escalation when the hotel has no chat id', async () => {
    const { service, chatService } = createHarness({
      notification_type: NotificationType.TEAMS,
    });

    await expect(
      service.handleEscalation(INPUT, '+15550001111'),
    ).rejects.toThrow(/does not have a teams chat ID/);
    expect(chatService.sendMessage).not.toHaveBeenCalled();
  });
});
