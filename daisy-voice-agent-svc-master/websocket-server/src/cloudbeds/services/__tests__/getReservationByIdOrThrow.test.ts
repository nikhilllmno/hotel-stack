/* global afterEach, beforeEach, describe, expect, it, jest, setTimeout */
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
import { CloudbedsAPIError } from '@/cloudbeds/errors';
import { CloudbedsReservationService } from '@/cloudbeds/services/reservationService';
import { CloudbedsGetReservationResponseData } from '@/cloudbeds/types';
import { Hotel } from '@/models/Hotel';
import { hotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import { Country, PaymentProvider } from '@/types/enums';
import logger from '@/utils/logger';

function buildHotel(): Hotel {
  return {
    id: 'hotel-uuid-1',
    name: 'Test Hotel',
    business_id: 'prop-123',
    pms_provider: 'cloudbeds',
    assistant_phone_number: '+15551234567',
    country: Country.US,
    timezone: 'America/Los_Angeles',
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
    status: 'confirmed',
    startDate: '2026-10-28',
    endDate: '2026-10-30',
    thirdPartyIdentifier: '2485822564',
    ...overrides,
  };
}

/** How the client reports Cloudbeds' answer for an id it doesn't know. */
const unknownReservation = () =>
  new CloudbedsAPIError('Reservation not found', 200);
const networkFailure = () =>
  new CloudbedsAPIError(
    'Network error connecting to Cloudbeds getReservation: socket hang up',
    500,
  );

/** A `getReservations` row: no `assigned` rooms. */
function sourceRow(
  overrides: Partial<CloudbedsGetReservationResponseData> = {},
): CloudbedsGetReservationResponseData {
  return {
    reservationID: 'CB-INTERNAL-99',
    propertyID: 'prop-123',
    status: 'confirmed',
    startDate: '2026-10-28',
    endDate: '2026-10-30',
    thirdPartyIdentifier: '2485822564',
    ...overrides,
  };
}

describe('CloudbedsReservationService.getReservationByIdOrThrow', () => {
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
    jest.useRealTimers();
  });

  it('returns the reservation found by Cloudbeds reservation id, without waiting on the source lookup', async () => {
    const reservation = buildReservationResponse();
    getReservationSpy.mockResolvedValue(reservation);
    getReservationsBySourceSpy.mockImplementation(() => new Promise(() => {}));

    await expect(
      service.getReservationByIdOrThrow(hotel, 'RES-001', 50),
    ).resolves.toEqual(reservation);
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

  it('does not log the source lookup as timed out once the direct lookup has found the reservation', async () => {
    const loggerError = jest
      .spyOn(logger, 'error')
      .mockImplementation(() => logger);
    const reservation = buildReservationResponse();
    getReservationSpy.mockResolvedValue(reservation);
    getReservationsBySourceSpy.mockImplementation(() => new Promise(() => {}));

    jest.useFakeTimers();
    await expect(
      service.getReservationByIdOrThrow(hotel, 'RES-001', 50),
    ).resolves.toEqual(reservation);
    await jest.advanceTimersByTimeAsync(50);

    expect(loggerError).not.toHaveBeenCalled();
  });

  describe('by source (OTA) reservation id', () => {
    /** Answers the direct lookup only for the given Cloudbeds ids. */
    function reservationsById(
      ...reservations: CloudbedsGetReservationResponseData[]
    ) {
      getReservationSpy.mockImplementation(
        async ({ reservationID }: { reservationID: string }) => {
          const found = reservations.find(
            (reservation) => reservation.reservationID === reservationID,
          );
          if (!found) throw unknownReservation();
          return found;
        },
      );
    }

    it('reads the matching reservation again by its Cloudbeds id, with its rooms', async () => {
      const reservation = buildReservationResponse({
        reservationID: 'CB-INTERNAL-99',
        assigned: [{ roomName: 'King 12', startDate: '2026-10-28' }],
      });
      reservationsById(reservation);
      getReservationsBySourceSpy.mockResolvedValue([sourceRow()]);

      await expect(
        service.getReservationByIdOrThrow(hotel, '2485822564'),
      ).resolves.toEqual(reservation);
      expect(getReservationSpy).toHaveBeenLastCalledWith(
        { propertyID: 'prop-123', reservationID: 'CB-INTERNAL-99' },
        expect.objectContaining({ apiToken: 'cbat_test_token' }),
      );
    });

    it('matches the source id regardless of case and spaces', async () => {
      const reservation = buildReservationResponse({
        reservationID: 'CB-INTERNAL-99',
      });
      reservationsById(reservation);
      getReservationsBySourceSpy.mockResolvedValue([
        sourceRow({ thirdPartyIdentifier: ' BK20640 ' }),
      ]);

      await expect(
        service.getReservationByIdOrThrow(hotel, 'bk20640'),
      ).resolves.toEqual(reservation);
    });

    it.each([
      ['carries another source id', { thirdPartyIdentifier: '999' }],
      ['has no source id', { thirdPartyIdentifier: undefined }],
      ['is for another property', { propertyID: 'prop-999' }],
    ])('ignores a row that %s', async (_case, overrides) => {
      reservationsById();
      getReservationsBySourceSpy.mockResolvedValue([sourceRow(overrides)]);

      await expect(
        service.getReservationByIdOrThrow(hotel, '2485822564'),
      ).resolves.toBeNull();
      expect(getReservationSpy).toHaveBeenCalledTimes(1);
    });

    it('ignores rows Cloudbeds returns for a source id of 0', async () => {
      reservationsById();
      getReservationsBySourceSpy.mockResolvedValue([
        sourceRow({ reservationID: 'CB-1' }),
        sourceRow({ reservationID: 'CB-2', thirdPartyIdentifier: '' }),
      ]);

      await expect(
        service.getReservationByIdOrThrow(hotel, '0'),
      ).resolves.toBeNull();
    });

    it('prefers the live reservation over a cancelled copy with the same source id', async () => {
      const live = buildReservationResponse({ reservationID: 'CB-LIVE' });
      reservationsById(live);
      getReservationsBySourceSpy.mockResolvedValue([
        sourceRow({ reservationID: 'CB-CANCELLED', status: 'canceled' }),
        sourceRow({ reservationID: 'CB-LIVE' }),
      ]);

      await expect(
        service.getReservationByIdOrThrow(hotel, '2485822564'),
      ).resolves.toEqual(live);
    });

    it('returns a cancelled copy when no live reservation has the source id', async () => {
      const cancelled = buildReservationResponse({
        reservationID: 'CB-CANCELLED',
        status: 'canceled',
      });
      reservationsById(cancelled);
      getReservationsBySourceSpy.mockResolvedValue([
        sourceRow({ reservationID: 'CB-CANCELLED', status: 'canceled' }),
      ]);

      await expect(
        service.getReservationByIdOrThrow(hotel, '2485822564'),
      ).resolves.toEqual(cancelled);
    });

    it('throws rather than pick one when two live reservations have the source id', async () => {
      reservationsById(
        buildReservationResponse({ reservationID: 'CB-1' }),
        buildReservationResponse({ reservationID: 'CB-2' }),
      );
      getReservationsBySourceSpy.mockResolvedValue([
        sourceRow({ reservationID: 'CB-1' }),
        sourceRow({ reservationID: 'CB-2', status: 'checked_in' }),
      ]);

      await expect(
        service.getReservationByIdOrThrow(hotel, '2485822564'),
      ).rejects.toThrow(/matches 2 live reservations/);
    });

    it('counts one reservation listed twice once', async () => {
      const reservation = buildReservationResponse({ reservationID: 'CB-1' });
      reservationsById(reservation);
      getReservationsBySourceSpy.mockResolvedValue([
        sourceRow({ reservationID: 'CB-1' }),
        sourceRow({ reservationID: 'CB-1' }),
      ]);

      await expect(
        service.getReservationByIdOrThrow(hotel, '2485822564'),
      ).resolves.toEqual(reservation);
    });

    it('throws when reading the match again fails', async () => {
      getReservationSpy
        .mockRejectedValueOnce(unknownReservation())
        .mockRejectedValueOnce(networkFailure());
      getReservationsBySourceSpy.mockResolvedValue([sourceRow()]);

      await expect(
        service.getReservationByIdOrThrow(hotel, '2485822564'),
      ).rejects.toThrow(/Network error/);
    });

    it('bounds reading the match again by what is left of the timeout', async () => {
      getReservationSpy
        .mockRejectedValueOnce(unknownReservation())
        .mockImplementationOnce(() => new Promise(() => {}));
      getReservationsBySourceSpy.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve([sourceRow()]), 40),
          ),
      );

      jest.useFakeTimers();
      const result = service.getReservationByIdOrThrow(hotel, '2485822564', 50);
      const assertion = expect(result).rejects.toThrow(/timed out/);
      await jest.advanceTimersByTimeAsync(40);
      await jest.advanceTimersByTimeAsync(10);
      await assertion;
    });
  });

  it.each([
    ['a success: false answer', 200],
    ['a 400', 400],
    ['a 404', 404],
  ])(
    'returns null when the direct lookup gets %s and the source lookup finds nothing',
    async (_case, statusCode) => {
      getReservationSpy.mockRejectedValue(
        new CloudbedsAPIError('Reservation not found', statusCode),
      );
      getReservationsBySourceSpy.mockResolvedValue([]);

      await expect(
        service.getReservationByIdOrThrow(hotel, 'UNKNOWN-ID'),
      ).resolves.toBeNull();
    },
  );

  it.each([
    ['a rate limit', 429],
    ['a request timeout', 408],
    ['an auth error', 401],
    ['a forbidden', 403],
  ])(
    'throws when the direct lookup gets %s, even if the source lookup found nothing',
    async (_case, statusCode) => {
      getReservationSpy.mockRejectedValue(
        new CloudbedsAPIError('Cloudbeds getReservation failed', statusCode),
      );
      getReservationsBySourceSpy.mockResolvedValue([]);

      await expect(
        service.getReservationByIdOrThrow(hotel, 'RES-001'),
      ).rejects.toThrow(/could not look up reservation RES-001/);
    },
  );

  it('throws when both lookups fail', async () => {
    getReservationSpy.mockRejectedValue(networkFailure());
    getReservationsBySourceSpy.mockRejectedValue(networkFailure());

    await expect(
      service.getReservationByIdOrThrow(hotel, 'RES-001'),
    ).rejects.toThrow(
      /could not look up reservation RES-001 \(direct: Network error.*; source: Network error/,
    );
  });

  it('throws when the direct lookup fails with a server error, even if the source lookup found nothing', async () => {
    getReservationSpy.mockRejectedValue(networkFailure());
    getReservationsBySourceSpy.mockResolvedValue([]);

    await expect(
      service.getReservationByIdOrThrow(hotel, 'RES-001'),
    ).rejects.toThrow(CloudbedsAPIError);
  });

  it('throws when the source lookup fails after the direct lookup found nothing', async () => {
    getReservationSpy.mockRejectedValue(unknownReservation());
    getReservationsBySourceSpy.mockRejectedValue(networkFailure());

    await expect(
      service.getReservationByIdOrThrow(hotel, 'RES-001'),
    ).rejects.toThrow(/source: Network error/);
  });

  it('throws when the direct lookup times out', async () => {
    getReservationSpy.mockImplementation(() => new Promise(() => {}));
    getReservationsBySourceSpy.mockResolvedValue([]);

    jest.useFakeTimers();
    const result = service.getReservationByIdOrThrow(hotel, 'RES-001', 50);
    const assertion = expect(result).rejects.toThrow(
      /direct: timed out after 50ms; source: no match/,
    );
    await jest.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it('logs a source lookup that times out after the direct lookup found nothing', async () => {
    const loggerError = jest
      .spyOn(logger, 'error')
      .mockImplementation(() => logger);
    getReservationSpy.mockRejectedValue(unknownReservation());
    getReservationsBySourceSpy.mockImplementation(() => new Promise(() => {}));

    jest.useFakeTimers();
    const result = service.getReservationByIdOrThrow(hotel, 'RES-001', 50);
    const assertion = expect(result).rejects.toThrow(
      /source: timed out after 50ms/,
    );
    await jest.advanceTimersByTimeAsync(50);
    await assertion;
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('source lookup timed out after 50ms'),
    );
  });

  it("throws when the hotel's Cloudbeds integration is disabled, without calling Cloudbeds", async () => {
    (
      hotelConfigurationService.getExternalAuthConfigByHotelId as jest.Mock
    ).mockResolvedValueOnce({
      apiToken: 'irrelevant',
      disabledAt: '2026-10-01',
    });

    await expect(
      service.getReservationByIdOrThrow(hotel, 'RES-001'),
    ).rejects.toThrow(/integration disabled/);
    expect(getReservationSpy).not.toHaveBeenCalled();
  });
});
