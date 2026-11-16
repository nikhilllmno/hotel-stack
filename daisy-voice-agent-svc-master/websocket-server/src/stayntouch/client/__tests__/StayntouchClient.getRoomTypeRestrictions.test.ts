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
import { RestrictionsResponse } from '@/stayntouch/types';

describe('StayntouchClient.getRoomTypeRestrictions', () => {
  const hotelId = '22222222-2222-2222-2222-222222222222';
  let client: StayntouchClient;

  beforeEach(() => {
    mockGet.mockReset();
    client = new StayntouchClient(hotelId);
  });

  it('calls the restrictions/room_type endpoint with date params', async () => {
    const apiResponse: RestrictionsResponse = {
      restrictions: [
        {
          room_type_id: 4399,
          closed: [
            {
              value: false,
              date_ranges: [{ from_date: '2026-08-13', to_date: '2026-08-30' }],
            },
          ],
          closed_arrival: [
            {
              value: false,
              date_ranges: [{ from_date: '2026-08-13', to_date: '2026-08-30' }],
            },
          ],
          closed_departure: [
            {
              value: false,
              date_ranges: [{ from_date: '2026-08-13', to_date: '2026-08-30' }],
            },
          ],
          min_stay_through: [
            {
              value: 2,
              date_ranges: [
                { from_date: '2026-08-13', to_date: '2026-08-13' },
                { from_date: '2026-08-16', to_date: '2026-08-27' },
              ],
            },
            {
              value: 3,
              date_ranges: [{ from_date: '2026-08-14', to_date: '2026-08-15' }],
            },
          ],
          min_length_of_stay: [],
          max_length_of_stay: [],
          min_advanced_booking: [],
          max_advanced_booking: [],
        },
      ],
    };

    mockGet.mockResolvedValue({ data: apiResponse });

    const result = await client.getRoomTypeRestrictions({
      hotel_id: 263,
      from_date: '2026-08-13',
      to_date: '2026-08-30',
    });

    expect(mockGet).toHaveBeenCalledWith('/restrictions/room_type', {
      params: { hotel_id: 263, from_date: '2026-08-13', to_date: '2026-08-30' },
    });
    expect(result.restrictions).toHaveLength(1);
    expect(result.restrictions[0].room_type_id).toBe(4399);
    expect(result.restrictions[0].min_stay_through).toHaveLength(2);
    expect(result.restrictions[0].min_stay_through[0].value).toBe(2);
    expect(result.restrictions[0].min_stay_through[1].value).toBe(3);
    expect(result.restrictions[0].min_length_of_stay).toHaveLength(0);
  });

  it('returns empty restrictions when API returns none', async () => {
    mockGet.mockResolvedValue({ data: { restrictions: [] } });

    const result = await client.getRoomTypeRestrictions({
      hotel_id: 263,
      from_date: '2026-08-10',
      to_date: '2026-08-12',
    });

    expect(result.restrictions).toHaveLength(0);
  });

  it('propagates API errors', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));

    await expect(
      client.getRoomTypeRestrictions({
        hotel_id: 263,
        from_date: '2026-08-10',
        to_date: '2026-08-12',
      }),
    ).rejects.toThrow('Network error');
  });
});
