/* global beforeEach, describe, expect, it, jest */
const mockGet = jest.fn();

jest.mock('@/utils/httpClient', () => ({
  createHttpClient: jest.fn(() => ({
    get: mockGet,
    post: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  })),
}));

import { CloudbedsClient } from '@/cloudbeds/client/CloudbedsClient';
import { CloudbedsAPIError } from '@/cloudbeds/errors';

describe('CloudbedsClient.getReservationsByCheckInDate', () => {
  let client: CloudbedsClient;
  const ctx = { apiToken: 'cbat_test', hotelId: 'hotel-1' };
  const query = {
    propertyID: 'prop-1',
    checkInFrom: '2026-10-27',
    checkInTo: '2026-10-28',
    includeGuestsDetails: true,
    pageNumber: 2,
    pageSize: 100,
  };

  beforeEach(() => {
    mockGet.mockReset();
    client = new CloudbedsClient();
  });

  it('asks /getReservations for one page of the arrivals, and returns it with the total', async () => {
    mockGet.mockResolvedValue({
      data: {
        success: true,
        data: [{ reservationID: 'RES-100', status: 'confirmed' }],
        count: 1,
        total: 101,
      },
    });

    await expect(
      client.getReservationsByCheckInDate(query, ctx),
    ).resolves.toEqual({
      reservations: [{ reservationID: 'RES-100', status: 'confirmed' }],
      total: 101,
    });
    expect(mockGet).toHaveBeenCalledWith('/getReservations', {
      params: query,
      headers: { Authorization: 'Bearer cbat_test' },
    });
  });

  it.each([[undefined], [null], ['12'], [-1]])(
    'has no total when Cloudbeds sends %j',
    async (total) => {
      mockGet.mockResolvedValue({ data: { success: true, data: [], total } });

      await expect(
        client.getReservationsByCheckInDate(query, ctx),
      ).resolves.toEqual({ reservations: [], total: null });
    },
  );

  it('throws CloudbedsAPIError when the API returns success: false', async () => {
    mockGet.mockResolvedValue({
      data: { success: false, message: 'Invalid property' },
    });

    await expect(
      client.getReservationsByCheckInDate(query, ctx),
    ).rejects.toThrow(CloudbedsAPIError);
  });

  it('throws CloudbedsAPIError when the data is not a list', async () => {
    mockGet.mockResolvedValue({
      data: { success: true, data: { reservationID: 'RES-100' } },
    });

    await expect(
      client.getReservationsByCheckInDate(query, ctx),
    ).rejects.toThrow('returned no reservation list');
  });

  it('throws CloudbedsAPIError on an HTTP failure', async () => {
    mockGet.mockRejectedValue({
      response: { status: 429, data: { success: false, message: 'Slow down' } },
      message: 'Request failed',
    });

    await expect(
      client.getReservationsByCheckInDate(query, ctx),
    ).rejects.toThrow(CloudbedsAPIError);
  });
});
