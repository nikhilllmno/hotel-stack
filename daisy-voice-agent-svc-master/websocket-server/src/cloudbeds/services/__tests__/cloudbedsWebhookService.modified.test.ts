jest.mock('@/services/hotelConfiguration/hotelConfigurationService', () => ({
  hotelConfigurationService: {
    getExternalAuthConfigByHotelId: jest.fn().mockResolvedValue({
      apiToken: jest
        .requireActual('@/utils/encryption')
        .encrypt('cbat_test_token'),
      disabledAt: null,
    }),
  },
}));

import { CloudbedsWebhookService } from '@/cloudbeds/services/cloudbedsWebhookService';
import { CloudbedsReservationModifiedPayload } from '@/cloudbeds/types/WebhookPayload';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { Hotel } from '@/models/Hotel';
import { Reservation } from '@/models/Reservation';
import { hotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import { Country, PaymentProvider } from '@/types/enums';

function buildHotel(): Hotel {
  return {
    id: 'hotel-uuid-1',
    name: 'Test Hotel',
    business_id: '12345',
    pms_provider: 'cloudbeds',
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

function buildModifiedPayload(
  overrides: Partial<CloudbedsReservationModifiedPayload> = {},
): CloudbedsReservationModifiedPayload {
  return {
    version: '1.0',
    timestamp: 1611758157.431234,
    event: 'reservation/dates_changed',
    propertyId: '12345',
    reservationId: '31415926',
    ...overrides,
  };
}

function buildLocalReservation(
  overrides: Partial<Reservation> = {},
): Reservation {
  return {
    id: 'res-uuid-1',
    booking_id: 'BK12345',
    business_id: '12345',
    hotel_id: 'hotel-uuid-1',
    pms_provider: 'cloudbeds',
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
    type: 'EXTERNAL' as any,
    source: 'DIRECT_HOTEL_RESERVATION' as any,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

const MODIFICATION_EVENTS = [
  'reservation/dates_changed',
  'reservation/accommodation_type_changed',
] as const;

// Skipped: webhook routing disabled by hotfix/deactivate_cloudbeds_webhooks
describe.skip('CloudbedsWebhookService – reservation modification events', () => {
  const mockHotelService = {
    getHotelByBusinessId: jest.fn(),
  };

  const mockSyncService = {
    findLocalReservation: jest.fn(),
    syncCreateReservation: jest.fn(),
    syncUpdateReservation: jest.fn(),
  };

  const mockClient = {
    getReservation: jest.fn(),
  };

  const mockHotelConfigRepo = {
    setExternalAuthConfigDisabledAt: jest.fn(),
  };

  let service: CloudbedsWebhookService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CloudbedsWebhookService(
      mockHotelService as any,
      mockSyncService as any,
      mockClient as any,
      mockHotelConfigRepo as any,
    );
  });

  it.each(MODIFICATION_EVENTS)(
    'updates reservation when local reservation exists (%s)',
    async (event) => {
      const hotel = buildHotel();
      const localReservation = buildLocalReservation();
      const fullReservation = {
        reservationID: '31415926',
        status: 'confirmed',
        startDate: '2026-07-10',
        endDate: '2026-07-14',
      };

      mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
      mockClient.getReservation.mockResolvedValue(fullReservation);
      mockSyncService.findLocalReservation.mockResolvedValue(localReservation);
      mockSyncService.syncUpdateReservation.mockResolvedValue({
        reservationId: 'res-uuid-1',
      });

      const payload = buildModifiedPayload({ event });
      const result = await service.handleWebhookEvent(payload);

      expect(mockHotelService.getHotelByBusinessId).toHaveBeenCalledWith(
        '12345',
      );
      expect(mockClient.getReservation).toHaveBeenCalled();
      expect(mockSyncService.syncUpdateReservation).toHaveBeenCalledWith(
        fullReservation,
        hotel,
        localReservation,
      );
      expect(result).toEqual({
        success: true,
        message: `Reservation updated via ${event}`,
        reservation_id: 'res-uuid-1',
      });
    },
  );

  it.each(MODIFICATION_EVENTS)(
    'skips when no local reservation is found (%s)',
    async (event) => {
      const hotel = buildHotel();

      mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
      mockClient.getReservation.mockResolvedValue({
        reservationID: '31415926',
        status: 'confirmed',
      });
      mockSyncService.findLocalReservation.mockResolvedValue(null);

      const payload = buildModifiedPayload({ event });
      const result = await service.handleWebhookEvent(payload);

      expect(mockSyncService.syncUpdateReservation).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'No local reservation found, skipped',
      });
    },
  );

  it('prefers propertyId_str over the numeric propertyId to avoid precision loss on large IDs', async () => {
    mockHotelService.getHotelByBusinessId.mockResolvedValue(null);

    const payload = buildModifiedPayload({
      propertyId: 9007199254740993,
      propertyId_str: '9007199254740993',
    });
    await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).toHaveBeenCalledWith(
      '9007199254740993',
    );
  });

  it('ignores unknown propertyId', async () => {
    mockHotelService.getHotelByBusinessId.mockResolvedValue(null);

    const payload = buildModifiedPayload({ propertyId: '99999' });
    const result = await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).toHaveBeenCalledWith('99999');
    expect(mockClient.getReservation).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Ignored: unknown property',
    });
  });

  it('throws when no API credentials are configured', async () => {
    const hotel = buildHotel();
    hotel.id = 'hotel-no-token';

    mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
    (
      hotelConfigurationService.getExternalAuthConfigByHotelId as jest.Mock
    ).mockResolvedValueOnce(null);

    const payload = buildModifiedPayload();
    await expect(service.handleWebhookEvent(payload)).rejects.toThrow(
      'resolveCloudbedsCredentials: Hotel hotel-no-token is missing external_auth_config',
    );

    expect(mockClient.getReservation).not.toHaveBeenCalled();
  });

  it('normalizes lowercase propertyId from payload', async () => {
    const hotel = buildHotel();
    const localReservation = buildLocalReservation();

    mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
    mockClient.getReservation.mockResolvedValue({
      reservationID: '31415926',
      status: 'confirmed',
    });
    mockSyncService.findLocalReservation.mockResolvedValue(localReservation);
    mockSyncService.syncUpdateReservation.mockResolvedValue({
      reservationId: 'res-uuid-1',
    });

    const payload = buildModifiedPayload({ propertyId: '12345' });
    await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).toHaveBeenCalledWith('12345');
  });

  it('skips when payload is missing required identifiers', async () => {
    const payload = buildModifiedPayload({
      propertyId: undefined as any,
      reservationId: undefined as any,
    });
    const result = await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Missing required identifiers',
    });
  });

  it('updates even when local reservation is in terminal status', async () => {
    const hotel = buildHotel();
    const localReservation = buildLocalReservation({
      status: ReservationStatus.CANCELLED,
    });
    const fullReservation = {
      reservationID: '31415926',
      status: 'canceled',
      startDate: '2026-07-10',
      endDate: '2026-07-14',
    };

    mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
    mockClient.getReservation.mockResolvedValue(fullReservation);
    mockSyncService.findLocalReservation.mockResolvedValue(localReservation);
    mockSyncService.syncUpdateReservation.mockResolvedValue({
      reservationId: 'res-uuid-1',
    });

    const payload = buildModifiedPayload();
    const result = await service.handleWebhookEvent(payload);

    expect(mockSyncService.syncUpdateReservation).toHaveBeenCalledWith(
      fullReservation,
      hotel,
      localReservation,
    );
    expect(result).toEqual({
      success: true,
      message: 'Reservation updated via reservation/dates_changed',
      reservation_id: 'res-uuid-1',
    });
  });
});
