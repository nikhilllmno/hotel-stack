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
import { ReservationSource } from '@/dtos/enum/ReservationSource';
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

const EXPECTED_CTX = expect.objectContaining({
  apiToken: 'cbat_test_token',
  hotelId: 'hotel-uuid-1',
});

describe('CloudbedsReservationService.lookupReservationsByGuestQueryFromPms', () => {
  const hotel = buildHotel();
  let service: CloudbedsReservationService;
  let getReservationsByGuestNameSpy: jest.SpyInstance;

  beforeEach(() => {
    const client = new CloudbedsClient();
    service = new CloudbedsReservationService(client);

    getReservationsByGuestNameSpy = jest.spyOn(
      client,
      'getReservationsByGuestName',
    );

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

  it('returns empty array without calling the client when the trimmed name is shorter than 2 characters', async () => {
    const result = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'a',
    );

    expect(result).toEqual([]);
    expect(getReservationsByGuestNameSpy).not.toHaveBeenCalled();
  });

  it('returns empty array without calling the client when the name is only whitespace', async () => {
    const result = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      '   ',
    );

    expect(result).toEqual([]);
    expect(getReservationsByGuestNameSpy).not.toHaveBeenCalled();
  });

  it('queries by lastName only for a single-word name', async () => {
    getReservationsByGuestNameSpy.mockResolvedValue([]);

    await service.lookupReservationsByGuestQueryFromPms(hotel, 'Madonna');

    expect(getReservationsByGuestNameSpy).toHaveBeenCalledTimes(1);
    expect(getReservationsByGuestNameSpy).toHaveBeenCalledWith(
      {
        propertyID: 'prop-123',
        lastName: 'Madonna',
        includeGuestsDetails: true,
      },
      EXPECTED_CTX,
    );
  });

  it('splits a two-word name into firstName and lastName', async () => {
    getReservationsByGuestNameSpy.mockResolvedValue([]);

    await service.lookupReservationsByGuestQueryFromPms(hotel, 'John Doe');

    expect(getReservationsByGuestNameSpy).toHaveBeenCalledWith(
      {
        propertyID: 'prop-123',
        firstName: 'John',
        lastName: 'Doe',
        includeGuestsDetails: true,
      },
      EXPECTED_CTX,
    );
  });

  it('treats the last token as lastName and everything before it as firstName for multi-word names', async () => {
    getReservationsByGuestNameSpy.mockResolvedValue([]);

    await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'Mary Jane Watson',
    );

    expect(getReservationsByGuestNameSpy).toHaveBeenCalledWith(
      {
        propertyID: 'prop-123',
        firstName: 'Mary Jane',
        lastName: 'Watson',
        includeGuestsDetails: true,
      },
      EXPECTED_CTX,
    );
  });

  it('trims surrounding whitespace and collapses inner whitespace before splitting', async () => {
    getReservationsByGuestNameSpy.mockResolvedValue([]);

    await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      '  John   Doe  ',
    );

    expect(getReservationsByGuestNameSpy).toHaveBeenCalledWith(
      {
        propertyID: 'prop-123',
        firstName: 'John',
        lastName: 'Doe',
        includeGuestsDetails: true,
      },
      EXPECTED_CTX,
    );
  });

  it('maps returned Cloudbeds reservations to reservation DTOs', async () => {
    getReservationsByGuestNameSpy.mockResolvedValue([
      buildReservationResponse({ reservationID: 'RES-A' }),
      buildReservationResponse({ reservationID: 'RES-B' }),
    ]);

    const result = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'John Doe',
    );

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.booking_id)).toEqual(['RES-A', 'RES-B']);
  });

  it('classifies a list-endpoint reservation as direct using the sourceName field', async () => {
    getReservationsByGuestNameSpy.mockResolvedValue([
      buildReservationResponse({
        reservationID: '5M5TA5VZVU',
        source: undefined,
        sourceName: 'Website/Booking Engine',
        origin: '',
      }),
    ]);

    const result = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'Pam Gold',
    );

    expect(result[0].reservation_source).toBe(
      ReservationSource.DIRECT_HOTEL_RESERVATION,
    );
  });

  it('falls back to sourceName when source is an empty string', async () => {
    getReservationsByGuestNameSpy.mockResolvedValue([
      buildReservationResponse({
        source: '',
        sourceName: 'Website/Booking Engine',
        origin: '',
      }),
    ]);

    const result = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'Pam Gold',
    );

    expect(result[0].reservation_source).toBe(
      ReservationSource.DIRECT_HOTEL_RESERVATION,
    );
  });

  it('classifies an OTA list-endpoint reservation as third party', async () => {
    getReservationsByGuestNameSpy.mockResolvedValue([
      buildReservationResponse({
        source: undefined,
        sourceName: 'Booking.com',
        origin: '',
      }),
    ]);

    const result = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'John Doe',
    );

    expect(result[0].reservation_source).toBe(
      ReservationSource.THIRD_PARTY_RESERVATION,
    );
  });

  it('returns empty array when the client finds no reservations', async () => {
    getReservationsByGuestNameSpy.mockResolvedValue([]);

    const result = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'John Doe',
    );

    expect(result).toEqual([]);
  });

  it('returns empty array when the client throws', async () => {
    getReservationsByGuestNameSpy.mockRejectedValue(new Error('Cloudbeds 500'));

    const result = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'John Doe',
    );

    expect(result).toEqual([]);
  });

  it('returns the fallback empty array when the lookup exceeds the timeout', async () => {
    getReservationsByGuestNameSpy.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([buildReservationResponse()]), 100);
        }),
    );

    const result = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'John Doe',
      10,
    );

    expect(result).toEqual([]);
  });
});
