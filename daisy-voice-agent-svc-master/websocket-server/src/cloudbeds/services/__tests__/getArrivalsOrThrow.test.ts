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
import { CloudbedsGetReservationResponseData } from '@/cloudbeds/types';
import { Hotel } from '@/models/Hotel';

const HOTEL = {
  id: 'hotel-uuid-1',
  business_id: 'prop-123',
  pms_provider: 'cloudbeds',
  timezone: 'America/Los_Angeles',
} as Hotel;

function arrivals(
  from: number,
  count: number,
): CloudbedsGetReservationResponseData[] {
  return Array.from({ length: count }, (_, index) => ({
    reservationID: `CB-${from + index}`,
    status: 'confirmed',
  }));
}

describe('CloudbedsReservationService.getArrivalsOrThrow', () => {
  let service: CloudbedsReservationService;
  let getPage: jest.SpyInstance;

  beforeEach(() => {
    const client = new CloudbedsClient();
    service = new CloudbedsReservationService(client);
    getPage = jest.spyOn(client, 'getReservationsByCheckInDate');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('lists every reservation checking in on the dates, with guest details, a page of 100 at a time', async () => {
    getPage.mockResolvedValue({ reservations: arrivals(1, 24), total: 24 });

    await expect(
      service.getArrivalsOrThrow(HOTEL, '2026-10-27', '2026-10-28'),
    ).resolves.toEqual(arrivals(1, 24));
    expect(getPage).toHaveBeenCalledTimes(1);
    expect(getPage).toHaveBeenCalledWith(
      {
        propertyID: 'prop-123',
        checkInFrom: '2026-10-27',
        checkInTo: '2026-10-28',
        includeGuestsDetails: true,
        pageNumber: 1,
        pageSize: 100,
      },
      expect.objectContaining({ apiToken: 'cbat_test_token' }),
    );
  });

  it('reads the next page while a page is full', async () => {
    getPage
      .mockResolvedValueOnce({ reservations: arrivals(1, 100), total: null })
      .mockResolvedValueOnce({ reservations: arrivals(101, 30), total: null });

    const result = await service.getArrivalsOrThrow(
      HOTEL,
      '2026-10-28',
      '2026-10-28',
    );

    expect(result).toHaveLength(130);
    expect(getPage).toHaveBeenCalledTimes(2);
    expect(getPage.mock.calls[1][0]).toMatchObject({ pageNumber: 2 });
  });

  it("reads on after a short page while Cloudbeds' total says more remain", async () => {
    getPage
      .mockResolvedValueOnce({ reservations: arrivals(1, 50), total: 80 })
      .mockResolvedValueOnce({ reservations: arrivals(51, 30), total: 80 });

    await expect(
      service.getArrivalsOrThrow(HOTEL, '2026-10-28', '2026-10-28'),
    ).resolves.toHaveLength(80);
    expect(getPage).toHaveBeenCalledTimes(2);
  });

  it('stops at an empty page, and lists a reservation repeated across pages once', async () => {
    getPage
      .mockResolvedValueOnce({ reservations: arrivals(1, 100), total: 150 })
      .mockResolvedValueOnce({ reservations: arrivals(100, 1), total: 150 })
      .mockResolvedValueOnce({ reservations: [], total: 150 });

    await expect(
      service.getArrivalsOrThrow(HOTEL, '2026-10-28', '2026-10-28'),
    ).resolves.toHaveLength(100);
    expect(getPage).toHaveBeenCalledTimes(3);
  });

  it('stops after 10 pages', async () => {
    let next = 1;
    getPage.mockImplementation(async () => {
      const page = arrivals(next, 100);
      next += 100;
      return { reservations: page, total: null };
    });

    await expect(
      service.getArrivalsOrThrow(HOTEL, '2026-10-28', '2026-10-28'),
    ).resolves.toHaveLength(1000);
    expect(getPage).toHaveBeenCalledTimes(10);
  });

  it('lets a Cloudbeds error throw', async () => {
    getPage.mockRejectedValue(
      new CloudbedsAPIError(
        'Cloudbeds getReservationsByCheckInDate failed',
        429,
      ),
    );

    await expect(
      service.getArrivalsOrThrow(HOTEL, '2026-10-28', '2026-10-28'),
    ).rejects.toThrow(CloudbedsAPIError);
  });

  it('throws when the pages take longer than the time limit in all', async () => {
    getPage
      .mockResolvedValueOnce({ reservations: arrivals(1, 100), total: null })
      .mockImplementation(() => new Promise(() => {}));

    jest.useFakeTimers();
    const result = service.getArrivalsOrThrow(
      HOTEL,
      '2026-10-28',
      '2026-10-28',
      50,
    );
    const assertion = expect(result).rejects.toThrow(/timed out after 50ms/);
    await jest.advanceTimersByTimeAsync(50);
    await assertion;
  });
});

describe('CloudbedsReservationService.getStaysOnDateOrThrow', () => {
  let service: CloudbedsReservationService;
  let getPage: jest.SpyInstance;

  beforeEach(() => {
    const client = new CloudbedsClient();
    service = new CloudbedsReservationService(client);
    getPage = jest.spyOn(client, 'getReservationsByCheckInDate');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('lists the reservations checking in from the date given up to the date, and out on it or later', async () => {
    getPage.mockResolvedValue({ reservations: arrivals(1, 3), total: 3 });

    await expect(
      service.getStaysOnDateOrThrow(HOTEL, '2026-09-30', '2026-10-30'),
    ).resolves.toEqual(arrivals(1, 3));
    expect(getPage).toHaveBeenCalledWith(
      {
        propertyID: 'prop-123',
        checkInFrom: '2026-09-30',
        checkInTo: '2026-10-30',
        checkOutFrom: '2026-10-30',
        includeGuestsDetails: true,
        pageNumber: 1,
        pageSize: 100,
      },
      expect.objectContaining({ apiToken: 'cbat_test_token' }),
    );
  });

  it('reads the next page while a page is full', async () => {
    getPage
      .mockResolvedValueOnce({ reservations: arrivals(1, 100), total: null })
      .mockResolvedValueOnce({ reservations: arrivals(101, 5), total: null });

    await expect(
      service.getStaysOnDateOrThrow(HOTEL, '2026-09-30', '2026-10-30'),
    ).resolves.toHaveLength(105);
  });

  it('throws when the pages take longer than the time limit in all', async () => {
    getPage.mockImplementation(() => new Promise(() => {}));

    jest.useFakeTimers();
    const result = service.getStaysOnDateOrThrow(
      HOTEL,
      '2026-09-30',
      '2026-10-30',
      50,
    );
    const assertion = expect(result).rejects.toThrow(
      /getStaysOnDateOrThrow: timed out after 50ms/,
    );
    await jest.advanceTimersByTimeAsync(50);
    await assertion;
  });
});
