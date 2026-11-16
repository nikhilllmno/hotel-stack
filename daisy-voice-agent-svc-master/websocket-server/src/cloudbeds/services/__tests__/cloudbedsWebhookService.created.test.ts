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
import { CloudbedsReservationCreatedPayload } from '@/cloudbeds/types/WebhookPayload';
import { ReservationSource } from '@/dtos/enum/ReservationSource';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
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

function buildCreatedPayload(
  overrides: Partial<CloudbedsReservationCreatedPayload> = {},
): CloudbedsReservationCreatedPayload {
  return {
    version: '1.0',
    timestamp: 1611758157.431234,
    event: 'reservation/created',
    propertyID: '12345',
    reservationID: '31415926',
    startDate: '2026-07-05',
    endDate: '2026-07-08',
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

// Skipped: webhook routing disabled by hotfix/deactivate_cloudbeds_webhooks
describe.skip('CloudbedsWebhookService – reservation/created', () => {
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

  it('creates new reservation for external booking', async () => {
    const hotel = buildHotel();
    const fullReservation = {
      reservationID: '31415926',
      status: 'confirmed',
      thirdPartyIdentifier: null,
    };

    mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
    mockClient.getReservation.mockResolvedValue(fullReservation);
    mockSyncService.findLocalReservation.mockResolvedValue(null);
    mockSyncService.syncCreateReservation.mockResolvedValue({
      reservationId: 'res-uuid-1',
    });

    const payload = buildCreatedPayload();
    const result = await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).toHaveBeenCalledWith('12345');
    expect(mockClient.getReservation).toHaveBeenCalled();
    expect(mockSyncService.syncCreateReservation).toHaveBeenCalledWith(
      fullReservation,
      hotel,
    );
    expect(result).toEqual({
      success: true,
      message: 'Reservation created',
      reservation_id: 'res-uuid-1',
    });
  });

  it('updates existing reservation on duplicate webhook', async () => {
    const hotel = buildHotel();
    const localReservation = buildLocalReservation();
    const fullReservation = {
      reservationID: '31415926',
      status: 'confirmed',
      thirdPartyIdentifier: null,
    };

    mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
    mockClient.getReservation.mockResolvedValue(fullReservation);
    mockSyncService.findLocalReservation.mockResolvedValue(localReservation);
    mockSyncService.isDaisyOriginatedReservation.mockReturnValue(false);
    mockSyncService.syncUpdateReservation.mockResolvedValue({
      reservationId: 'res-uuid-1',
    });

    const payload = buildCreatedPayload();
    const result = await service.handleWebhookEvent(payload);

    expect(mockSyncService.syncCreateReservation).not.toHaveBeenCalled();
    expect(mockSyncService.syncUpdateReservation).toHaveBeenCalledWith(
      fullReservation,
      hotel,
      localReservation,
    );
    expect(result).toEqual({
      success: true,
      message: 'Reservation updated',
      reservation_id: 'res-uuid-1',
    });
  });

  it('skips Daisy-originated reservation', async () => {
    const hotel = buildHotel();
    const localReservation = buildLocalReservation({
      type: SessionType.CALL,
      source: ReservationSource.DIRECT_HOTEL_RESERVATION,
    });
    const fullReservation = {
      reservationID: '31415926',
      status: 'confirmed',
      thirdPartyIdentifier: 'BK12345',
    };

    mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
    mockClient.getReservation.mockResolvedValue(fullReservation);
    mockSyncService.findLocalReservation.mockResolvedValue(localReservation);
    mockSyncService.isDaisyOriginatedReservation.mockReturnValue(true);

    const payload = buildCreatedPayload();
    const result = await service.handleWebhookEvent(payload);

    expect(mockSyncService.findLocalReservation).toHaveBeenCalledWith(
      hotel,
      '31415926',
    );
    expect(mockSyncService.isDaisyOriginatedReservation).toHaveBeenCalledWith(
      localReservation,
    );
    expect(mockSyncService.syncCreateReservation).not.toHaveBeenCalled();
    expect(mockSyncService.syncUpdateReservation).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Daisy-originated reservation, skipped',
    });
  });

  it('ignores unknown propertyID', async () => {
    mockHotelService.getHotelByBusinessId.mockResolvedValue(null);

    const payload = buildCreatedPayload({ propertyID: '99999' });
    const result = await service.handleWebhookEvent(payload);

    expect(mockHotelService.getHotelByBusinessId).toHaveBeenCalledWith('99999');
    expect(mockClient.getReservation).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: 'Ignored: unknown property',
    });
  });

  it('skips when payload is missing required identifiers', async () => {
    const payload = buildCreatedPayload({
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

  it('throws when no API credentials are configured', async () => {
    const hotel = buildHotel();
    hotel.id = 'hotel-no-token';

    mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
    (
      hotelConfigurationService.getExternalAuthConfigByHotelId as jest.Mock
    ).mockResolvedValueOnce(null);

    const payload = buildCreatedPayload();
    await expect(service.handleWebhookEvent(payload)).rejects.toThrow(
      'resolveCloudbedsCredentials: Hotel hotel-no-token is missing external_auth_config',
    );

    expect(mockClient.getReservation).not.toHaveBeenCalled();
  });
});
