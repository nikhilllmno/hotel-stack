import { CloudbedsWebhookService } from '@/cloudbeds/services/cloudbedsWebhookService';
import { CloudbedsWebhookBasePayload } from '@/cloudbeds/types/WebhookPayload';

describe('CloudbedsWebhookService – event dispatch', () => {
  const mockHotelService = {
    getHotelByBusinessId: jest.fn(),
  };

  const mockSyncService = {
    findLocalReservation: jest.fn(),
    syncCreateReservation: jest.fn(),
    syncUpdateReservation: jest.fn(),
    isDaisyOriginatedReservation: jest.fn(),
  };

  const mockClient = {
    getReservation: jest.fn(),
  };

  const mockHotelConfigRepo = {
    setExternalAuthConfigDisabledAt: jest.fn(),
  };

  const mockRoomReservationService = {
    cancelReservation: jest.fn(),
  };

  let service: CloudbedsWebhookService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CloudbedsWebhookService(
      mockHotelService as any,
      mockSyncService as any,
      mockClient as any,
      mockHotelConfigRepo as any,
      mockRoomReservationService as any,
    );
  });

  it('returns success without side effects for an unhandled event type', async () => {
    const payload: CloudbedsWebhookBasePayload = {
      version: '1.0',
      timestamp: 1611758157.431234,
      event: 'reservation/checked_in',
    };

    const result = await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).not.toHaveBeenCalled();
    expect(mockClient.getReservation).not.toHaveBeenCalled();
    expect(mockSyncService.findLocalReservation).not.toHaveBeenCalled();
    expect(
      mockHotelConfigRepo.setExternalAuthConfigDisabledAt,
    ).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Event type reservation/checked_in not handled',
    });
  });

  it('does not throw for an empty/unrecognized event string', async () => {
    const payload: CloudbedsWebhookBasePayload = {
      version: '1.0',
      timestamp: 1611758157.431234,
      event: 'totally/unknown_event',
    };

    const result = await service.handleWebhookEvent(payload);

    expect(result).toEqual({
      success: true,
      message: 'Event type totally/unknown_event not handled',
    });
  });

  it('does not route reservation/created even though its payload shape matches', async () => {
    const payload: CloudbedsWebhookBasePayload = {
      version: '1.0',
      timestamp: 1611758157.431234,
      event: 'reservation/created',
    };

    const result = await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Event type reservation/created not handled',
    });
  });

  it('routes reservation/status_changed to the cancellation flow', async () => {
    mockHotelService.getHotelByBusinessId.mockResolvedValue(null);

    const payload: CloudbedsWebhookBasePayload & {
      propertyID: number;
      reservationID: string;
      status: string;
    } = {
      version: '1.0',
      timestamp: 1611758157.431234,
      event: 'reservation/status_changed',
      propertyID: 12345,
      reservationID: '31415926',
      status: 'canceled',
    };

    const result = await service.handleWebhookEvent(payload as any);

    // Reaching the "unknown property" branch (rather than the generic
    // "not handled" message) proves this event type is actually routed.
    expect(mockHotelService.getHotelByBusinessId).toHaveBeenCalledWith('12345');
    expect(result).toEqual({
      success: true,
      message: 'Ignored: unknown property',
    });
  });
});
