/* global afterEach, beforeEach, describe, expect, it, jest */
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

describe('CloudbedsReservationService.getReservationByIdFromCloudbeds', () => {
  const hotel = buildHotel();
  let service: CloudbedsReservationService;
  let getReservationSpy: jest.SpyInstance;
  let getReservationsBySourceSpy: jest.SpyInstance;

  beforeEach(() => {
    const client = new CloudbedsClient();
    service = new CloudbedsReservationService(client);

    getReservationSpy = jest.spyOn(client, 'getReservation');
    getReservationsBySourceSpy = jest.spyOn(client, 'getReservationsBySource');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the raw reservation when found by Cloudbeds reservation ID', async () => {
    const reservation = buildReservationResponse();
    getReservationSpy.mockResolvedValue(reservation);
    getReservationsBySourceSpy.mockResolvedValue([]);

    const result = await service.getReservationByIdFromCloudbeds(
      hotel,
      'RES-001',
    );

    expect(result).toEqual(reservation);
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

  it('falls back to the third-party source reservation ID when the direct lookup fails', async () => {
    const reservation = buildReservationResponse({
      reservationID: 'CB-INTERNAL-99',
    });
    getReservationSpy.mockImplementation(
      async ({ reservationID }: { reservationID: string }) => {
        if (reservationID !== 'CB-INTERNAL-99') throw new Error('Not found');
        return reservation;
      },
    );
    getReservationsBySourceSpy.mockResolvedValue([reservation]);

    const result = await service.getReservationByIdFromCloudbeds(
      hotel,
      '2485822564',
    );

    expect(result).toEqual(reservation);
  });

  it('returns null, logged, when two live reservations carry the source ID', async () => {
    getReservationSpy.mockRejectedValue(new Error('Not found'));
    getReservationsBySourceSpy.mockResolvedValue([
      buildReservationResponse({ reservationID: 'CB-1' }),
      buildReservationResponse({ reservationID: 'CB-2' }),
    ]);

    const result = await service.getReservationByIdFromCloudbeds(
      hotel,
      '2485822564',
    );

    expect(result).toBeNull();
  });

  it('prefers the direct ID lookup result over the source lookup', async () => {
    const directReservation = buildReservationResponse({
      reservationID: 'RES-DIRECT',
      balance: 0,
    });
    const sourceReservation = buildReservationResponse({
      reservationID: 'RES-SOURCE',
      balance: 150,
    });

    getReservationSpy.mockResolvedValue(directReservation);
    getReservationsBySourceSpy.mockResolvedValue([sourceReservation]);

    const result = await service.getReservationByIdFromCloudbeds(
      hotel,
      'RES-DIRECT',
    );

    expect(result).toEqual(directReservation);
  });

  it('returns null when both lookups fail', async () => {
    getReservationSpy.mockRejectedValue(new Error('Not found'));
    getReservationsBySourceSpy.mockRejectedValue(new Error('Not found'));

    const result = await service.getReservationByIdFromCloudbeds(
      hotel,
      'UNKNOWN-ID',
    );

    expect(result).toBeNull();
  });

  it('returns null when the direct lookup fails and the source lookup returns no results', async () => {
    getReservationSpy.mockRejectedValue(new Error('Not found'));
    getReservationsBySourceSpy.mockResolvedValue([]);

    const result = await service.getReservationByIdFromCloudbeds(
      hotel,
      'UNKNOWN-ID',
    );

    expect(result).toBeNull();
  });

  it('returns the direct result immediately, without waiting on a stalled source lookup', async () => {
    const reservation = buildReservationResponse();
    getReservationSpy.mockResolvedValue(reservation);
    // Never resolves — simulates a stalled/hung source lookup. If the
    // implementation waited on this before returning, the assertion below
    // would need a timer advance to resolve and this test would hang.
    getReservationsBySourceSpy.mockImplementation(() => new Promise(() => {}));

    jest.useFakeTimers();
    try {
      const result = await service.getReservationByIdFromCloudbeds(
        hotel,
        'RES-001',
        50,
      );

      expect(result).toEqual(reservation);
    } finally {
      jest.useRealTimers();
    }
  });

  it('waits for the source lookup, bounded by its own timeout, when the direct lookup fails', async () => {
    getReservationSpy.mockRejectedValue(new Error('Not found'));
    // Never resolves — simulates a stalled/hung source lookup.
    getReservationsBySourceSpy.mockImplementation(() => new Promise(() => {}));

    jest.useFakeTimers();
    try {
      const resultPromise = service.getReservationByIdFromCloudbeds(
        hotel,
        'RES-001',
        50,
      );
      await jest.advanceTimersByTimeAsync(50);
      const result = await resultPromise;

      expect(result).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
