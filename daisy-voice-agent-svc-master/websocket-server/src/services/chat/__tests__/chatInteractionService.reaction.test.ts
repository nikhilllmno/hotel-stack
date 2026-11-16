import { EscalationStatus } from '@/dtos/enum/EscalationStatus';
import { Hotel } from '@/models/Hotel';
import { HotelRepository } from '@/repositories/HotelRepository';
import { ChatInteractionService } from '@/services/chat/chatInteractionService';
import { EscalationService } from '@/services/escalation/escalationService';
import { HotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';

const HOTEL = { id: 'hotel-1' } as Hotel;

function createHarness(allowedEmojis?: string[]) {
  const escalationService = {
    findEscalationByExternalMessageId: jest
      .fn()
      .mockResolvedValue({ id: 'esc-1', status: EscalationStatus.OPEN }),
    updateEscalation: jest.fn().mockResolvedValue(undefined),
  };
  const hotelConfigurationService = {
    getHotelConfigurationByHotelId: jest.fn().mockResolvedValue({
      escalation_report_configuration: { allowed_emojis: allowedEmojis },
    }),
  };
  const service = new ChatInteractionService(
    {} as HotelRepository,
    hotelConfigurationService as unknown as HotelConfigurationService,
    escalationService as unknown as EscalationService,
  );
  return { service, escalationService };
}

describe('ChatInteractionService.handleEscalationReaction', () => {
  it('marks the escalation DONE for an allowed emoji', async () => {
    const { service, escalationService } = createHarness(['👍']);

    await service.handleEscalationReaction({
      hotel: HOTEL,
      externalMessageId: '100',
      addedEmojis: ['😮', '👍'],
      user: 'Mia',
    });

    expect(
      escalationService.findEscalationByExternalMessageId,
    ).toHaveBeenCalledWith('100', 'hotel-1');
    expect(escalationService.updateEscalation).toHaveBeenCalledWith('esc-1', {
      status: EscalationStatus.DONE,
    });
  });

  it('ignores emojis the hotel did not allow', async () => {
    const { service, escalationService } = createHarness(['✅']);

    await service.handleEscalationReaction({
      hotel: HOTEL,
      externalMessageId: '100',
      addedEmojis: ['👍'],
      user: 'Mia',
    });

    expect(escalationService.updateEscalation).not.toHaveBeenCalled();
  });

  it('does nothing when the hotel has no allowed emojis', async () => {
    const { service, escalationService } = createHarness(undefined);

    await service.handleEscalationReaction({
      hotel: HOTEL,
      externalMessageId: '100',
      addedEmojis: ['👍'],
      user: 'Mia',
    });

    expect(
      escalationService.findEscalationByExternalMessageId,
    ).not.toHaveBeenCalled();
  });
});
