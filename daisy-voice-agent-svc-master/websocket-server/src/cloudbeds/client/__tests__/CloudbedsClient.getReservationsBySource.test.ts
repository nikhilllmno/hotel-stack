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

describe('CloudbedsClient.getReservationsBySource', () => {
  let client: CloudbedsClient;
  const ctx = { apiToken: 'cbat_test', hotelId: 'hotel-1' };

  beforeEach(() => {
    mockGet.mockReset();
    client = new CloudbedsClient();
  });

  it('calls /getReservations with propertyID and sourceReservationId', async () => {
    mockGet.mockResolvedValue({
      data: {
        success: true,
        data: [{ reservationID: 'RES-100', status: 'confirmed' }],
      },
    });

    const result = await client.getReservationsBySource(
      { propertyID: 'prop-1', sourceReservationId: '2485822564' },
      ctx,
    );

    expect(mockGet).toHaveBeenCalledWith('/getReservations', {
      params: { propertyID: 'prop-1', sourceReservationId: '2485822564' },
      headers: { Authorization: 'Bearer cbat_test' },
    });
    expect(result).toEqual([{ reservationID: 'RES-100', status: 'confirmed' }]);
  });

  it('returns empty array when API returns success with empty data', async () => {
    mockGet.mockResolvedValue({
      data: { success: true, data: [] },
    });

    const result = await client.getReservationsBySource(
      { propertyID: 'prop-1', sourceReservationId: 'NONEXISTENT' },
      ctx,
    );

    expect(result).toEqual([]);
  });

  it('throws CloudbedsAPIError when API returns success: false', async () => {
    mockGet.mockResolvedValue({
      data: { success: false, message: 'Invalid property' },
    });

    await expect(
      client.getReservationsBySource(
        { propertyID: 'bad-prop', sourceReservationId: '123' },
        ctx,
      ),
    ).rejects.toThrow(CloudbedsAPIError);
  });

  it('throws CloudbedsAPIError on network failure', async () => {
    mockGet.mockRejectedValue({
      response: {
        status: 500,
        data: { success: false, message: 'Internal Server Error' },
      },
      message: 'Request failed',
    });

    await expect(
      client.getReservationsBySource(
        { propertyID: 'prop-1', sourceReservationId: '123' },
        ctx,
      ),
    ).rejects.toThrow(CloudbedsAPIError);
  });
});
