process.env.STAYNTOUCH_BASE_URL = 'https://api.stayntouch.test/connect';

const mockGet = jest.fn();

jest.mock('@/utils/httpClient', () => ({
  createHttpClient: jest.fn(() => ({
    get: mockGet,
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  })),
}));

jest.mock('@/stayntouch/services/tokenService', () => ({
  stayntouchTokenService: {
    getActiveToken: jest.fn().mockResolvedValue('test-token'),
  },
}));

import { StayntouchClient } from '@/stayntouch/client/StayntouchClient';

describe('StayntouchClient.searchReservations', () => {
  const hotelId = '22222222-2222-2222-2222-222222222222';
  let client: StayntouchClient;

  beforeEach(() => {
    mockGet.mockReset();
    client = new StayntouchClient(hotelId);
  });

  it('returns empty results when phone search has insufficient digits', async () => {
    const response = await client.searchReservations(1001, {
      mobile_number: '123',
    });

    expect(response).toEqual({ results: [], total_count: 0 });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('passes search params through to the reservations endpoint', async () => {
    mockGet.mockResolvedValue({
      data: { results: [], total_count: 0 },
    });

    await client.searchReservations(1001, { last_name: 'Roper' });

    expect(mockGet).toHaveBeenCalledWith('/reservations', {
      params: {
        hotel_id: 1001,
        last_name: 'Roper',
      },
    });
  });
});
