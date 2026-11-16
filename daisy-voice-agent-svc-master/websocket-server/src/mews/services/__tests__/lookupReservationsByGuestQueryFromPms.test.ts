jest.mock('@/mews/client/MewsClient', () => ({
  mewsClient: {
    searchCustomers: jest.fn(),
    getAllServices: jest.fn(),
    getReservations: jest.fn(),
    getAgeCategories: jest.fn(),
  },
}));

jest.mock('@/config', () => ({
  __esModule: true,
  default: {
    ...jest.requireActual('@/config').default,
    MEWS_CLIENT_TOKEN: 'ct',
    MEWS_CLIENT: 'Test 1.0.0',
  },
}));

jest.mock('@/mews/services/tokenService', () => ({
  mewsTokenService: {
    getActiveToken: jest.fn().mockResolvedValue('at'),
    resolveEnterpriseId: jest.fn().mockResolvedValue(undefined),
  },
}));

import { ReservationLookupSource } from '@/dtos/enum/ReservationLookupSource';
import { mewsClient } from '@/mews/client/MewsClient';
import { MewsReservationService } from '@/mews/services/reservationService';
import { MewsCredentials } from '@/mews/types';
import { Hotel } from '@/models/Hotel';
import { HotelService } from '@/services/hotel/hotelService';

const HOTEL_ID = 'hotel-1';

const CREDENTIALS: MewsCredentials = {
  clientToken: 'ct',
  accessToken: 'at',
  client: 'Test 1.0.0',
};

function buildHotel(): Hotel {
  return {
    id: HOTEL_ID,
    timezone: 'UTC',
    business_id: 'enterprise-1',
    assistant_phone_number: '+15550000001',
  } as Hotel;
}

function makeService(): MewsReservationService {
  const hotelService = {
    getHotelById: jest.fn().mockResolvedValue(buildHotel()),
    getHotelByAssistantPhoneNumber: jest.fn().mockResolvedValue(buildHotel()),
  } as unknown as HotelService;
  return new MewsReservationService(hotelService);
}

describe('MewsReservationService.lookupReservationsByGuestQueryFromPms', () => {
  const hotel = buildHotel();
  let service: MewsReservationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    (mewsClient.searchCustomers as jest.Mock).mockResolvedValue([]);
  });

  it('returns empty array without calling Mews when the trimmed name is shorter than 2 characters', async () => {
    const result = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'a',
    );

    expect(result).toEqual([]);
    expect(mewsClient.searchCustomers).not.toHaveBeenCalled();
  });

  it('returns empty array without calling Mews when the name is only whitespace', async () => {
    const result = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      '   ',
    );

    expect(result).toEqual([]);
    expect(mewsClient.searchCustomers).not.toHaveBeenCalled();
  });

  it('queries a single-token name as a last name when no source is given', async () => {
    await service.lookupReservationsByGuestQueryFromPms(hotel, 'Max');

    expect(mewsClient.searchCustomers).toHaveBeenCalledTimes(1);
    expect(mewsClient.searchCustomers).toHaveBeenCalledWith(
      { lastNames: ['Max'] },
      CREDENTIALS,
    );
  });

  it('queries a single-token name as a first name for the door-code source', async () => {
    await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'Max',
      undefined,
      ReservationLookupSource.DOOR_CODE,
    );

    expect(mewsClient.searchCustomers).toHaveBeenCalledTimes(1);
    expect(mewsClient.searchCustomers).toHaveBeenCalledWith(
      { firstNames: ['Max'] },
      CREDENTIALS,
    );
  });

  it('does not send a last name filter for a single-token door-code lookup', async () => {
    await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'Madonna',
      undefined,
      ReservationLookupSource.DOOR_CODE,
    );

    expect(mewsClient.searchCustomers).toHaveBeenCalledWith(
      expect.not.objectContaining({ lastNames: expect.anything() }),
      CREDENTIALS,
    );
  });

  it('splits a two-token name into firstNames and lastNames', async () => {
    await service.lookupReservationsByGuestQueryFromPms(hotel, 'Max Brown');

    expect(mewsClient.searchCustomers).toHaveBeenCalledWith(
      { firstNames: ['Max'], lastNames: ['Brown'] },
      CREDENTIALS,
    );
  });

  it('splits a multi-token name the same way for the door-code source', async () => {
    await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'Max Brown',
      undefined,
      ReservationLookupSource.DOOR_CODE,
    );

    expect(mewsClient.searchCustomers).toHaveBeenCalledWith(
      { firstNames: ['Max'], lastNames: ['Brown'] },
      CREDENTIALS,
    );
  });

  it('treats the last token as the last name and everything before it as the first name', async () => {
    await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'Mary Jane Watson',
    );

    expect(mewsClient.searchCustomers).toHaveBeenCalledWith(
      { firstNames: ['Mary Jane'], lastNames: ['Watson'] },
      CREDENTIALS,
    );
  });

  it('trims surrounding whitespace and collapses inner whitespace before splitting', async () => {
    await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      '  Max   Brown  ',
    );

    expect(mewsClient.searchCustomers).toHaveBeenCalledWith(
      { firstNames: ['Max'], lastNames: ['Brown'] },
      CREDENTIALS,
    );
  });

  it('stops before fetching services when no customer matches', async () => {
    const result = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'Max',
    );

    expect(result).toEqual([]);
    expect(mewsClient.getAllServices).not.toHaveBeenCalled();
  });

  it('returns empty array when the customer search throws', async () => {
    (mewsClient.searchCustomers as jest.Mock).mockRejectedValue(
      new Error('Request failed with status code 429'),
    );

    const result = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'Max Brown',
    );

    expect(result).toEqual([]);
  });

  it('returns the fallback empty array when the lookup exceeds the timeout', async () => {
    (mewsClient.searchCustomers as jest.Mock).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 100)),
    );

    const result = await service.lookupReservationsByGuestQueryFromPms(
      hotel,
      'Max Brown',
      10,
    );

    expect(result).toEqual([]);
  });
});
