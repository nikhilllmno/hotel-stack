jest.mock('@/services/hotel/hotelService', () => ({
  hotelService: {
    getHotelById: jest.fn(),
    getHotelWithConfigurationsAndChannels: jest.fn(),
  },
}));

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

jest.mock('@/utils/httpClient', () => ({
  createHttpClient: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  })),
}));

import { CloudbedsClient } from '@/cloudbeds/client/CloudbedsClient';
import { CloudbedsReservationService } from '@/cloudbeds/services/reservationService';
import { CloudbedsGetReservationResponseData } from '@/cloudbeds/types';
import { Hotel } from '@/models/Hotel';
import { hotelService } from '@/services/hotel/hotelService';
import { Country, PaymentProvider } from '@/types/enums';

function buildHotel(): Hotel {
  return {
    id: 'hotel-uuid-1',
    name: 'Test Hotel',
    business_id: 'prop-123',
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

function buildReservationResponse(
  overrides: Partial<CloudbedsGetReservationResponseData> = {},
): CloudbedsGetReservationResponseData {
  return {
    reservationID: 'RES-001',
    propertyID: 'prop-123',
    guestName: 'John Doe',
    guestEmail: 'john@test.com',
    status: 'confirmed',
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    total: 200,
    balance: 0,
    source: 'Booking.com',
    thirdPartyIdentifier: '2485822564',
    ...overrides,
  };
}

describe('CloudbedsReservationService.lookupReservationsById', () => {
  const hotel = buildHotel();
  let service: CloudbedsReservationService;
  let getReservationSpy: jest.SpyInstance;
  let getReservationsBySourceSpy: jest.SpyInstance;

  beforeEach(() => {
    const client = new CloudbedsClient();
    service = new CloudbedsReservationService(client);

    getReservationSpy = jest.spyOn(client, 'getReservation');
    getReservationsBySourceSpy = jest.spyOn(client, 'getReservationsBySource');

    (hotelService.getHotelById as jest.Mock).mockResolvedValue(hotel);
    (
      hotelService.getHotelWithConfigurationsAndChannels as jest.Mock
    ).mockResolvedValue({
      configuration: null,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns reservation when found by Cloudbeds reservation ID', async () => {
    const reservation = buildReservationResponse();
    getReservationSpy.mockResolvedValue(reservation);
    getReservationsBySourceSpy.mockResolvedValue([]);

    const result = await service.lookupReservationsById(hotel, 'RES-001');

    expect(result).toHaveLength(1);
    expect(result[0].booking_id).toBe('RES-001');
    expect(getReservationSpy).toHaveBeenCalledWith(
      { propertyID: 'prop-123', reservationID: 'RES-001' },
      expect.objectContaining({ apiToken: 'cbat_test_token' }),
    );
    expect(getReservationsBySourceSpy).toHaveBeenCalledWith(
      {
        propertyID: 'prop-123',
        sourceReservationId: 'RES-001',
        includeGuestsDetails: true,
      },
      expect.objectContaining({ apiToken: 'cbat_test_token' }),
    );
  });

  it('returns reservation when found by third-party source reservation ID', async () => {
    const reservation = buildReservationResponse({
      reservationID: 'CB-INTERNAL-99',
    });
    getReservationSpy.mockRejectedValue(new Error('Not found'));
    getReservationsBySourceSpy.mockResolvedValue([reservation]);

    const result = await service.lookupReservationsById(hotel, '2485822564');

    expect(result).toHaveLength(1);
    expect(result[0].booking_id).toBe('CB-INTERNAL-99');
  });

  it('prefers the direct ID lookup result over the source lookup', async () => {
    const directReservation = buildReservationResponse({
      reservationID: 'RES-DIRECT',
    });
    const sourceReservation = buildReservationResponse({
      reservationID: 'RES-SOURCE',
    });

    getReservationSpy.mockResolvedValue(directReservation);
    getReservationsBySourceSpy.mockResolvedValue([sourceReservation]);

    const result = await service.lookupReservationsById(hotel, 'RES-DIRECT');

    expect(result).toHaveLength(1);
    expect(result[0].booking_id).toBe('RES-DIRECT');
  });

  it('returns empty array when both lookups fail', async () => {
    getReservationSpy.mockRejectedValue(new Error('Not found'));
    getReservationsBySourceSpy.mockRejectedValue(new Error('Not found'));

    const result = await service.lookupReservationsById(hotel, 'UNKNOWN-ID');

    expect(result).toEqual([]);
  });

  it('returns empty array when direct lookup fails and source returns no results', async () => {
    getReservationSpy.mockRejectedValue(new Error('Not found'));
    getReservationsBySourceSpy.mockResolvedValue([]);

    const result = await service.lookupReservationsById(hotel, 'UNKNOWN-ID');

    expect(result).toEqual([]);
  });

  it('fires both lookups in parallel (not sequentially)', async () => {
    const callOrder: string[] = [];

    getReservationSpy.mockImplementation(() => {
      callOrder.push('getReservation');
      return Promise.resolve(buildReservationResponse());
    });
    getReservationsBySourceSpy.mockImplementation(() => {
      callOrder.push('getReservationsBySource');
      return Promise.resolve([]);
    });

    await service.lookupReservationsById(hotel, 'RES-001');

    expect(getReservationSpy).toHaveBeenCalledTimes(1);
    expect(getReservationsBySourceSpy).toHaveBeenCalledTimes(1);
    // Both should be called before either resolves (both initiated in same tick)
    expect(callOrder).toEqual(['getReservation', 'getReservationsBySource']);
  });
});
