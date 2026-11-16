jest.mock('@/calry/services/calryCredentials', () => ({
  resolveCalryCredentials: jest.fn(),
}));

jest.mock('@/services/hotel/hotelService', () => ({
  hotelService: {
    getHotelById: jest.fn(),
    getHotelByBusinessId: jest.fn(),
    getHotelByAssistantPhoneNumber: jest.fn(),
    getHotelWithConfigurationsAndChannels: jest.fn(),
  },
}));

jest.mock('@/services/hotelConfiguration/hotelConfigurationService', () => ({
  hotelConfigurationService: {
    getHotelConfigurationByHotelId: jest.fn(),
    // Null auth config => not Opera-backed => the unified Calry path.
    getExternalAuthConfigByHotelId: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('@/services/roomReservation/helper', () => ({
  validateAndCorrectDates: jest.fn((start_date: string, end_date: string) => ({
    start_date,
    end_date,
    dateCorrectionDetails: undefined,
  })),
}));

import { CalryRoomUnavailableError } from '@/calry/errors';
import { resolveCalryCredentials } from '@/calry/services/calryCredentials';
import { CalryReservationService } from '@/calry/services/reservationService';
import { CalryCredentials, CalryRoomsInfo } from '@/calry/types';
import { SessionType } from '@/dtos/enum/SessionType';
import { Reservation as ReservationDTO } from '@/dtos/Reservation';
import { BadRequestError } from '@/errors/BadRequestError';
import { hotelService } from '@/services/hotel/hotelService';
import { hotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import { PaymentProvider } from '@/types/enums';

const CREDENTIALS: CalryCredentials = {
  propertyId: '212815',
  apiToken: 'calry_token_abc',
  workspaceId: 'workspace-1',
  integrationAccountId: 'integration-account-1',
  hotelId: 'hotel-uuid-1',
};

const HOTEL = {
  id: 'hotel-uuid-1',
  business_id: '212815',
  currency: 'USD',
  timezone: 'America/New_York',
  assistant_phone_number: '+15551234567',
  payment_provider: PaymentProvider.NOT_APPLICABLE,
};

const ROOM_TYPES = [
  { id: '341959', name: 'Deluxe King', maxOccupancy: 3 },
  { id: '341967', name: 'Standard Twin', maxOccupancy: 2 },
];

const mockResolveCredentials = resolveCalryCredentials as jest.Mock;
const mockGetHotelByPhone =
  hotelService.getHotelByAssistantPhoneNumber as jest.Mock;
const mockGetHotelByBusinessId = hotelService.getHotelByBusinessId as jest.Mock;
const mockGetHotelConfig =
  hotelConfigurationService.getHotelConfigurationByHotelId as jest.Mock;

function openNights(unitsAvailable = 2) {
  return {
    propertyId: '212815',
    roomTypeId: '341959',
    dateWiseAvailability: [
      { date: '2026-09-01', status: 'AVAILABLE', unitsAvailable },
      { date: '2026-09-02', status: 'AVAILABLE', unitsAvailable },
      // The checkout date is returned by Calry but is never an occupied night.
      { date: '2026-09-03', status: 'NOT_AVAILABLE', unitsAvailable: 0 },
    ],
  };
}

function quoteFor(totalPrice: number) {
  return {
    propertyId: '212815',
    roomTypeId: '341959',
    currency: 'USD',
    ratePlans: [
      {
        ratePlanId: 'BAR',
        totalPrice,
        basePrice: { totalBasePrice: totalPrice - 60 },
        fee: { totalFee: 20 },
        tax: { totalTax: 40 },
      },
    ],
  };
}

const AVAILABILITY_PARAMS = {
  start_date: '2026-09-01',
  end_date: '2026-09-03',
  num_adults: 2,
  num_children: 0,
  num_pets: 0,
  session_type: SessionType.CALL,
  booking_link: false,
};

describe('CalryReservationService availability', () => {
  let client: {
    getRoomTypes: jest.Mock;
    getAvailability: jest.Mock;
    getQuote: jest.Mock;
  };
  let service: CalryReservationService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveCredentials.mockResolvedValue(CREDENTIALS);
    mockGetHotelByPhone.mockResolvedValue(HOTEL);
    mockGetHotelByBusinessId.mockResolvedValue(HOTEL);
    mockGetHotelConfig.mockResolvedValue(null);

    client = {
      getRoomTypes: jest.fn().mockResolvedValue(ROOM_TYPES),
      getAvailability: jest.fn().mockResolvedValue(openNights()),
      getQuote: jest.fn().mockResolvedValue(quoteFor(600)),
    };
    service = new CalryReservationService(client as never);
  });

  it('prices every open room type', async () => {
    const result = await service.getRoomAvailabilityWithQuote(
      AVAILABILITY_PARAMS,
      '+19876543210',
      '+15551234567',
    );

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]).toMatchObject({
      room_id: '341959',
      room_name: 'Deluxe King',
      available_units: 2,
    });
    expect(result.groups[0].pricing.total_amount).toBe(600);
  });

  it('ignores the checkout date when judging availability', async () => {
    const result = await service.getRoomAvailabilityWithQuote(
      AVAILABILITY_PARAMS,
      '+19876543210',
      '+15551234567',
    );

    // 2026-09-03 is NOT_AVAILABLE but is the checkout day, so the stay is
    // still bookable.
    expect(result.groups).toHaveLength(2);
  });

  it('drops room types that are closed for any night of the stay', async () => {
    client.getAvailability.mockResolvedValue({
      ...openNights(),
      dateWiseAvailability: [
        { date: '2026-09-01', status: 'AVAILABLE', unitsAvailable: 2 },
        { date: '2026-09-02', status: 'NOT_AVAILABLE', unitsAvailable: 0 },
      ],
    });

    const result = await service.getRoomAvailabilityWithQuote(
      AVAILABILITY_PARAMS,
      '+19876543210',
      '+15551234567',
    );

    expect(result.groups).toHaveLength(0);
  });

  it('skips a room type whose quote fails rather than failing the whole search', async () => {
    client.getQuote
      .mockRejectedValueOnce(new Error('upstream exploded'))
      .mockResolvedValue(quoteFor(600));

    const result = await service.getRoomAvailabilityWithQuote(
      AVAILABILITY_PARAMS,
      '+19876543210',
      '+15551234567',
    );

    expect(result.groups).toHaveLength(1);
  });

  it('charges nothing up front, since Calry hotels collect at the desk', async () => {
    const result = await service.getRoomAvailabilityWithQuote(
      AVAILABILITY_PARAMS,
      '+19876543210',
      '+15551234567',
    );

    expect(result.groups[0].pricing.amountCharged).toBe(0);
  });

  it('describes each room type in the lite response', async () => {
    const result = await service.getRoomAvailabilityWithQuoteLite(
      AVAILABILITY_PARAMS,
      '+19876543210',
      '+15551234567',
    );

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]['Deluxe King']).toContain('Deluxe King');
    expect(result.groups[0]['Deluxe King']).toContain('$600.00');
    expect(result.groups[0]['Deluxe King']).toContain('No payment is required');
  });

  it('lists every rate plan for a room type, ignoring the configured allow-list', async () => {
    mockGetHotelConfig.mockResolvedValue({
      rate_code_config: { allowed: ['BAR'] },
    });
    client.getQuote.mockResolvedValue({
      propertyId: '212815',
      roomTypeId: '341959',
      currency: 'USD',
      ratePlans: [
        { ratePlanId: 'BAR', name: 'Best Available', totalPrice: 600 },
        { ratePlanId: 'AAA', name: 'AAA Member', totalPrice: 540 },
      ],
    });

    const result = await service.getAllRatesForRoomType(
      { start_date: '2026-09-01', end_date: '2026-09-03', num_adults: 2 },
      '341959',
      '+19876543210',
      '+15551234567',
    );

    expect(result.groups).toHaveLength(2);
    expect(result.groups[1]['AAA Member']).toContain('$540.00');
  });

  it('does not support the web V2 availability flow', async () => {
    await expect(service.getWebRoomAvailabilityV2()).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });
});

describe('CalryReservationService.validateRoomAvailability', () => {
  let client: { getAvailability: jest.Mock };
  let service: CalryReservationService;

  function buildReservation(
    overrides: Partial<ReservationDTO> = {},
  ): ReservationDTO {
    return {
      room_id: '341959',
      check_in: new Date('2026-09-01T00:00:00.000Z'),
      check_out: new Date('2026-09-03T00:00:00.000Z'),
      hotel: HOTEL,
      ...overrides,
    } as unknown as ReservationDTO;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveCredentials.mockResolvedValue(CREDENTIALS);
    client = { getAvailability: jest.fn().mockResolvedValue(openNights(1)) };
    service = new CalryReservationService(client as never);
  });

  it('passes when every night has a free unit', async () => {
    await expect(
      service.validateRoomAvailability([buildReservation()]),
    ).resolves.toBeUndefined();
  });

  it('rejects when the room type is sold out', async () => {
    client.getAvailability.mockResolvedValue({
      ...openNights(),
      dateWiseAvailability: [
        { date: '2026-09-01', status: 'NOT_AVAILABLE', unitsAvailable: 0 },
        { date: '2026-09-02', status: 'AVAILABLE', unitsAvailable: 1 },
      ],
    });

    await expect(
      service.validateRoomAvailability([buildReservation()]),
    ).rejects.toBeInstanceOf(CalryRoomUnavailableError);
  });

  it('requires enough units when several rooms of one type are booked together', async () => {
    // One unit free, but the booking needs two of the same room type.
    await expect(
      service.validateRoomAvailability([
        buildReservation(),
        buildReservation(),
      ]),
    ).rejects.toBeInstanceOf(CalryRoomUnavailableError);
  });
});

describe('CalryReservationService.validateMultiRoomOccupancy', () => {
  const service = new CalryReservationService({} as never);

  const roomsInfo: CalryRoomsInfo = {
    rooms: [
      { room_id: '341959', room_name: 'Deluxe King', max_occupancy: 3 },
      { room_id: '341967', room_name: 'Standard Twin', max_occupancy: 2 },
    ],
    note: '',
  };

  it('accepts occupancy within the room type maximum', async () => {
    await expect(
      service.validateMultiRoomOccupancy(
        { '341959': [{ num_adults: 2, num_children: 1 }] },
        roomsInfo,
        'hotel-uuid-1',
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects an unknown room type', async () => {
    await expect(
      service.validateMultiRoomOccupancy(
        { '999999': [{ num_adults: 1, num_children: 0 }] },
        roomsInfo,
        'hotel-uuid-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('requires at least one adult per room', async () => {
    await expect(
      service.validateMultiRoomOccupancy(
        { '341959': [{ num_adults: 0, num_children: 2 }] },
        roomsInfo,
        'hotel-uuid-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects occupancy over the room type maximum', async () => {
    await expect(
      service.validateMultiRoomOccupancy(
        { '341967': [{ num_adults: 2, num_children: 2 }] },
        roomsInfo,
        'hotel-uuid-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects malformed rooms information', async () => {
    await expect(
      service.validateMultiRoomOccupancy(
        { '341959': [{ num_adults: 1, num_children: 0 }] },
        {} as CalryRoomsInfo,
        'hotel-uuid-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe('CalryReservationService room info', () => {
  let client: { getRoomTypes: jest.Mock };
  let service: CalryReservationService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveCredentials.mockResolvedValue(CREDENTIALS);
    mockGetHotelByBusinessId.mockResolvedValue(HOTEL);
    client = { getRoomTypes: jest.fn().mockResolvedValue(ROOM_TYPES) };
    service = new CalryReservationService(client as never);
  });

  it('maps Calry room types onto the shared room info shape', async () => {
    const info = await service.getRoomsInfo('212815');

    expect(info.rooms).toEqual([
      {
        room_id: '341959',
        room_name: 'Deluxe King',
        description: undefined,
        max_occupancy: 3,
      },
      {
        room_id: '341967',
        room_name: 'Standard Twin',
        description: undefined,
        max_occupancy: 2,
      },
    ]);
  });

  it('builds a room id to name map', async () => {
    const map = await service.getRoomTypeMap('212815');

    expect(map.get('341959')).toBe('Deluxe King');
    expect(map.get('341967')).toBe('Standard Twin');
  });
});

describe('CalryReservationService reservation enrichment', () => {
  const service = new CalryReservationService({} as never);

  it('does not fetch discounts, which Calry cannot express for our hotels', () => {
    expect(service.shouldFetchDiscount()).toBe(false);
  });

  it('records the pet count as partner notes', () => {
    expect(service.buildPartnerNotes({ numPets: 2 })).toBe(
      'Number of Pets = 2;',
    );
  });

  it('writes no notes when there are no pets', () => {
    expect(service.buildPartnerNotes({ numPets: 0 })).toBeNull();
    expect(service.buildPartnerNotes({})).toBeNull();
  });

  it('refuses phone lookups rather than silently returning nothing', async () => {
    await expect(service.lookupReservationsByPhone()).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });
});
