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

describe('CloudbedsClient.getAvailableRoomTypes', () => {
  let client: CloudbedsClient;
  const ctx = { apiToken: 'cbat_test', hotelId: 'hotel-1' };
  const query = {
    propertyIDs: 'prop-1',
    startDate: '2026-09-15',
    endDate: '2026-09-16',
    adults: 2,
    children: 0,
  };

  beforeEach(() => {
    mockGet.mockReset();
    client = new CloudbedsClient();
  });

  it('flattens the nested propertyRooms payload Cloudbeds actually returns', async () => {
    mockGet.mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            propertyID: '320454',
            propertyCurrency: {
              currencyCode: 'USD',
              currencySymbol: '$',
              currencyPosition: 'before',
            },
            propertyRooms: [
              {
                roomTypeID: '674377',
                roomTypeName: 'Deluxe Queen',
                maxGuests: '2',
                adultsIncluded: '2',
                childrenIncluded: 0,
                roomsAvailable: '7',
                roomRate: 159,
                roomRateID: '3074692',
                ratePlanNamePublic: 'default',
                ratePlanNamePrivate: 'default',
              },
            ],
          },
        ],
      },
    });

    const result = await client.getAvailableRoomTypes(query, ctx);

    expect(mockGet).toHaveBeenCalledWith('/getAvailableRoomTypes', {
      params: query,
      headers: { Authorization: 'Bearer cbat_test' },
    });
    expect(result).toEqual([
      {
        propertyID: '320454',
        roomTypeID: '674377',
        roomTypeName: 'Deluxe Queen',
        maxGuests: 2,
        adultsIncluded: 2,
        childrenIncluded: 0,
        roomsAvailable: 7,
        roomRate: 159,
        roomRateID: '3074692',
        ratePlanNamePublic: 'default',
        ratePlanNamePrivate: 'default',
      },
    ]);
  });

  it('keeps only the "default" rate plan entry when a room type has multiple', async () => {
    // getRate has no rate-plan selector — it always resolves to "default",
    // so a non-default plan's roomsAvailable/pricing would never actually
    // apply and must be dropped, not merged in.
    mockGet.mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            propertyID: '320454',
            propertyRooms: [
              {
                roomTypeID: '674377',
                roomTypeName: 'Deluxe Queen',
                roomsAvailable: '2',
                ratePlanNamePublic: 'Non-Refundable',
              },
              {
                roomTypeID: '674377',
                roomTypeName: 'Deluxe Queen',
                roomsAvailable: '7',
                ratePlanNamePublic: 'default',
              },
              {
                roomTypeID: '674378',
                roomTypeName: 'Deluxe King',
                roomsAvailable: '5',
                ratePlanNamePublic: 'default',
              },
            ],
          },
        ],
      },
    });

    const result = await client.getAvailableRoomTypes(query, ctx);

    expect(result).toEqual([
      {
        propertyID: '320454',
        roomTypeID: '674377',
        roomTypeName: 'Deluxe Queen',
        roomsAvailable: 7,
        ratePlanNamePublic: 'default',
      },
      {
        propertyID: '320454',
        roomTypeID: '674378',
        roomTypeName: 'Deluxe King',
        roomsAvailable: 5,
        ratePlanNamePublic: 'default',
      },
    ]);
  });

  it('falls back to the unfiltered list when a property has no plan named "default"', async () => {
    mockGet.mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            propertyID: '320454',
            propertyRooms: [
              {
                roomTypeID: '674377',
                roomTypeName: 'Deluxe Queen',
                roomsAvailable: '7',
                ratePlanNamePublic: 'Standard Rate',
              },
            ],
          },
        ],
      },
    });

    const result = await client.getAvailableRoomTypes(query, ctx);

    expect(result).toEqual([
      {
        propertyID: '320454',
        roomTypeID: '674377',
        roomTypeName: 'Deluxe Queen',
        roomsAvailable: 7,
        ratePlanNamePublic: 'Standard Rate',
      },
    ]);
  });

  it('flattens across multiple properties, dropping ones with no rooms', async () => {
    mockGet.mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            propertyID: 'prop-a',
            propertyRooms: [
              {
                roomTypeID: 'rt-1',
                roomTypeName: 'Room A',
                roomsAvailable: '3',
                ratePlanNamePublic: 'default',
              },
            ],
          },
          { propertyID: 'prop-b', propertyRooms: [] },
        ],
      },
    });

    const result = await client.getAvailableRoomTypes(query, ctx);

    expect(result).toEqual([
      {
        propertyID: 'prop-a',
        roomTypeID: 'rt-1',
        roomTypeName: 'Room A',
        roomsAvailable: 3,
        ratePlanNamePublic: 'default',
      },
    ]);
  });

  it('passes through an already-flat payload unchanged', async () => {
    mockGet.mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            propertyID: 'prop-1',
            roomTypeID: 'rt-1',
            roomTypeName: 'Room A',
            roomsAvailable: 5,
          },
        ],
      },
    });

    const result = await client.getAvailableRoomTypes(query, ctx);

    expect(result).toEqual([
      {
        propertyID: 'prop-1',
        roomTypeID: 'rt-1',
        roomTypeName: 'Room A',
        roomsAvailable: 5,
      },
    ]);
  });

  it('throws CloudbedsAPIError when API returns success: false', async () => {
    mockGet.mockResolvedValue({
      data: { success: false, message: 'Invalid property' },
    });

    await expect(client.getAvailableRoomTypes(query, ctx)).rejects.toThrow(
      CloudbedsAPIError,
    );
  });
});
