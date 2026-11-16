import { CloudbedsWebhookService } from '@/cloudbeds/services/cloudbedsWebhookService';
import { CloudbedsReservationStatusChangedPayload } from '@/cloudbeds/types/WebhookPayload';
import { CancellationSource } from '@/dtos/enum/CancellationSource';
import { ReservationSource } from '@/dtos/enum/ReservationSource';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import { Hotel } from '@/models/Hotel';
import { Reservation } from '@/models/Reservation';
import { Country, PaymentProvider, PmsProvider } from '@/types/enums';

function buildHotel(): Hotel {
  return {
    id: 'hotel-uuid-1',
    name: 'Test Hotel',
    business_id: '12345',
    pms_provider: PmsProvider.CLOUDBEDS,
    assistant_phone_number: '+15551234567',
    country: Country.US,
    timezone: 'America/New_York',
    telegram_check_in_group_id: 'group-1',
    telegram_alerts_group_id: 'group-2',
    sms_number: '+15551234567',
    internal_phone_number: '+15551234568',
    url: 'https://hotel.test',
    address: '1 Test St',
    image_url: 'https://hotel.test/image.png',
    currency: 'USD',
    payment_provider: PaymentProvider.SHIFT4,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function buildStatusChangedPayload(
  overrides: Partial<CloudbedsReservationStatusChangedPayload> = {},
): CloudbedsReservationStatusChangedPayload {
  return {
    version: '1.0',
    timestamp: 1611758157.431234,
    event: 'reservation/status_changed',
    propertyID: '12345',
    reservationID: '31415926',
    status: 'canceled',
    ...overrides,
  };
}

// Default fixture represents a Dextr-originated reservation (created via a
// call/chat/sms/web session), matching the one flow this handler now serves.
function buildLocalReservation(
  overrides: Partial<Reservation> = {},
): Reservation {
  return {
    id: 'res-uuid-1',
    booking_id: 'BK12345',
    business_id: '12345',
    hotel_id: 'hotel-uuid-1',
    pms_provider: PmsProvider.CLOUDBEDS,
    room_id: 100,
    customer_id: 'cust-uuid-1',
    check_in: new Date('2026-07-05'),
    check_out: new Date('2026-07-08'),
    num_adults: 2,
    num_children: 0,
    phone_number: '+15551234567',
    status: ReservationStatus.ACTIVE,
    room_type: 'Deluxe King',
    external_id: '31415926',
    type: SessionType.CALL,
    source: ReservationSource.DIRECT_HOTEL_RESERVATION,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('CloudbedsWebhookService – reservation/status_changed', () => {
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
    mockSyncService.isDaisyOriginatedReservation.mockReturnValue(true);
    service = new CloudbedsWebhookService(
      mockHotelService as any,
      mockSyncService as any,
      mockClient as any,
      mockHotelConfigRepo as any,
      mockRoomReservationService as any,
    );
  });

  it('cancels a Dextr-originated reservation in Dextr when status is canceled and ACTIVE', async () => {
    const hotel = buildHotel();
    const localReservation = buildLocalReservation();

    mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
    mockSyncService.findLocalReservation.mockResolvedValue(localReservation);
    mockRoomReservationService.cancelReservation.mockResolvedValue({
      reservationCancelResult: { id: 'res-uuid-1' },
      errors: [],
    });

    const payload = buildStatusChangedPayload({ status: 'canceled' });
    const result = await service.handleWebhookEvent(payload);

    expect(mockClient.getReservation).not.toHaveBeenCalled();
    expect(mockRoomReservationService.cancelReservation).toHaveBeenCalledWith(
      localReservation.booking_id,
      CancellationSource.PMS,
      undefined,
      'Cancelled in Cloudbeds',
      hotel.id,
    );
    expect(mockSyncService.syncUpdateReservation).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Reservation status updated to canceled',
      reservation_id: 'res-uuid-1',
    });
  });

  it('skips when the reservation was not created via Dextr', async () => {
    const hotel = buildHotel();
    const localReservation = buildLocalReservation();

    mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
    mockSyncService.findLocalReservation.mockResolvedValue(localReservation);
    mockSyncService.isDaisyOriginatedReservation.mockReturnValue(false);

    const payload = buildStatusChangedPayload({ status: 'canceled' });
    const result = await service.handleWebhookEvent(payload);

    expect(mockRoomReservationService.cancelReservation).not.toHaveBeenCalled();
    expect(mockSyncService.syncUpdateReservation).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Not a Dextr-originated reservation, skipped',
    });
  });

  it('skips when the reservation is not currently ACTIVE', async () => {
    const hotel = buildHotel();
    const localReservation = buildLocalReservation({
      status: ReservationStatus.INACTIVE,
    });

    mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
    mockSyncService.findLocalReservation.mockResolvedValue(localReservation);

    const payload = buildStatusChangedPayload({ status: 'canceled' });
    const result = await service.handleWebhookEvent(payload);

    expect(mockRoomReservationService.cancelReservation).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Reservation is INACTIVE, not cancellable, skipped',
    });
  });

  it('skips when local reservation is already CANCELLED (idempotent)', async () => {
    const hotel = buildHotel();
    const localReservation = buildLocalReservation({
      status: ReservationStatus.CANCELLED,
    });

    mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
    mockSyncService.findLocalReservation.mockResolvedValue(localReservation);

    const payload = buildStatusChangedPayload({ status: 'canceled' });
    const result = await service.handleWebhookEvent(payload);

    expect(mockRoomReservationService.cancelReservation).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Reservation already CANCELLED, skipped',
    });
  });

  it('returns early without hotel lookup for a non-canceled status', async () => {
    const payload = buildStatusChangedPayload({ status: 'checked_in' });
    const result = await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Status transition to checked_in not actionable',
    });
  });

  it('ignores no_show — that flow remains disabled', async () => {
    const payload = buildStatusChangedPayload({ status: 'no_show' });
    const result = await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Status transition to no_show not actionable',
    });
  });

  it('prefers propertyID_str over the numeric propertyID to avoid precision loss on large IDs', async () => {
    mockHotelService.getHotelByBusinessId.mockResolvedValue(null);

    const payload = buildStatusChangedPayload({
      propertyID: 9007199254740993,
      propertyID_str: '9007199254740993',
      status: 'canceled',
    });
    await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).toHaveBeenCalledWith(
      '9007199254740993',
    );
  });

  it('ignores unknown propertyID', async () => {
    mockHotelService.getHotelByBusinessId.mockResolvedValue(null);

    const payload = buildStatusChangedPayload({
      propertyID: '99999',
      status: 'canceled',
    });
    const result = await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).toHaveBeenCalledWith('99999');
    expect(mockSyncService.findLocalReservation).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Ignored: unknown property',
    });
  });

  it('skips when payload is missing required identifiers', async () => {
    const payload = buildStatusChangedPayload({
      propertyID: undefined as any,
      reservationID: undefined as any,
    });
    const result = await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Missing required identifiers',
    });
  });

  it('skips when no local reservation is found', async () => {
    const hotel = buildHotel();

    mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
    mockSyncService.findLocalReservation.mockResolvedValue(null);

    const payload = buildStatusChangedPayload({ status: 'canceled' });
    const result = await service.handleWebhookEvent(payload);

    expect(mockSyncService.isDaisyOriginatedReservation).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'No local reservation found, skipped',
    });
  });
});
