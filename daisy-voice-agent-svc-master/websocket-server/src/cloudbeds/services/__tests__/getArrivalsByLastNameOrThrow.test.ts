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
import { CloudbedsAPIError } from '@/cloudbeds/errors';
import { CloudbedsReservationService } from '@/cloudbeds/services/reservationService';
import { Hotel } from '@/models/Hotel';

const HOTEL = {
  id: 'hotel-uuid-1',
  business_id: 'prop-123',
  pms_provider: 'cloudbeds',
  timezone: 'America/Los_Angeles',
} as Hotel;

describe('CloudbedsReservationService.getArrivalsByLastNameOrThrow', () => {
  let service: CloudbedsReservationService;
  let getReservationsByGuestNameSpy: jest.SpyInstance;

  beforeEach(() => {
    const client = new CloudbedsClient();
    service = new CloudbedsReservationService(client);
    getReservationsByGuestNameSpy = jest.spyOn(
      client,
      'getReservationsByGuestName',
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('searches the reservations checking in on the date by main-guest last name, with guest details', async () => {
    const arrivals = [
      { reservationID: 'CB-1', status: 'confirmed', guestName: 'John Smith' },
    ];
    getReservationsByGuestNameSpy.mockResolvedValue(arrivals);

    await expect(
      service.getArrivalsByLastNameOrThrow(HOTEL, 'Smith', '2026-10-28'),
    ).resolves.toEqual(arrivals);
    expect(getReservationsByGuestNameSpy).toHaveBeenCalledWith(
      {
        propertyID: 'prop-123',
        lastName: 'Smith',
        checkInFrom: '2026-10-28',
        checkInTo: '2026-10-28',
        includeGuestsDetails: true,
      },
      expect.objectContaining({ apiToken: 'cbat_test_token' }),
    );
  });

  it('lets a Cloudbeds error throw', async () => {
    getReservationsByGuestNameSpy.mockRejectedValue(
      new CloudbedsAPIError('Cloudbeds getReservationsByGuestName failed', 429),
    );

    await expect(
      service.getArrivalsByLastNameOrThrow(HOTEL, 'Smith', '2026-10-28'),
    ).rejects.toThrow(CloudbedsAPIError);
  });

  it('throws when the search times out', async () => {
    getReservationsByGuestNameSpy.mockImplementation(
      () => new Promise(() => {}),
    );

    jest.useFakeTimers();
    const result = service.getArrivalsByLastNameOrThrow(
      HOTEL,
      'Smith',
      '2026-10-28',
      50,
    );
    const assertion = expect(result).rejects.toThrow(/timed out after 50ms/);
    await jest.advanceTimersByTimeAsync(50);
    await assertion;
  });
});
