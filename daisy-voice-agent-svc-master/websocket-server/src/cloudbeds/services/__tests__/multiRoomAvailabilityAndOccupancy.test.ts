jest.mock('@/services/hotel/hotelService', () => ({
  hotelService: {
    getHotelById: jest.fn(),
    getHotelByAssistantPhoneNumber: jest.fn(),
    getHotelByBusinessId: jest.fn(),
  },
}));

jest.mock('@/services/hotelConfiguration/hotelConfigurationService', () => ({
  hotelConfigurationService: {
    getHotelConfigurationByHotelId: jest.fn().mockResolvedValue(null),
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
import { CloudbedsReservationService } from '@/cloudbeds/services/reservationService';
import { CloudbedsRoomInfo } from '@/cloudbeds/types';
import { SessionType } from '@/dtos/enum/SessionType';
import { Hotel } from '@/models/Hotel';
import { PeoplePerRoom } from '@/models/request/roomReservation';
import { hotelService } from '@/services/hotel/hotelService';
import { Country, PaymentProvider } from '@/types/enums';

function buildHotel(overrides: Partial<Hotel> = {}): Hotel {
  return {
    id: 'hotel-uuid-1',
    name: 'Test Hotel',
    business_id: 'prop-123',
    pms_provider: 'cloudbeds',
    assistant_phone_number: '+15551234567',
    country: Country.US,
    timezone: 'America/New_York',
    telegram_check_in_group_id: 'group-1',
    telegram_alerts_group_id: 'group-2',
    sms_number: '+15551234567',
    internal_phone_number: '+15551234568',
    url: 'https://hotel.test',
    address: '1 Test St',
    image_url: 'https://hotel.test/image.png',
    currency: 'USD',
    payment_provider: PaymentProvider.NOT_APPLICABLE,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function buildRoomsInfo(): { rooms: CloudbedsRoomInfo[] } {
  return {
    rooms: [
      {
        room_id: '674377',
        room_name: 'Deluxe Queen',
        room_code: 'DQ',
        max_occupancy: 4,
        max_adults: 2,
        max_children: 2,
      },
      {
        room_id: '674378',
        room_name: 'Deluxe King',
        room_code: 'DK',
        max_occupancy: 2,
        max_adults: 2,
        max_children: 0,
      },
    ],
  };
}

describe('CloudbedsReservationService.validateMultiRoomOccupancy', () => {
  let service: CloudbedsReservationService;

  beforeEach(() => {
    const client = new CloudbedsClient();
    service = new CloudbedsReservationService(client);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes when occupancy is within limits', async () => {
    const peoplePerRoom: PeoplePerRoom = {
      '674377': [{ num_adults: 2, num_children: 1 }],
      '674378': [{ num_adults: 1, num_children: 0 }],
    };

    await expect(
      service.validateMultiRoomOccupancy(
        peoplePerRoom,
        buildRoomsInfo(),
        'hotel-uuid-1',
      ),
    ).resolves.toBeUndefined();
  });

  it('passes with multiple rooms of the same type', async () => {
    const peoplePerRoom: PeoplePerRoom = {
      '674377': [
        { num_adults: 2, num_children: 0 },
        { num_adults: 1, num_children: 1 },
      ],
    };

    await expect(
      service.validateMultiRoomOccupancy(
        peoplePerRoom,
        buildRoomsInfo(),
        'hotel-uuid-1',
      ),
    ).resolves.toBeUndefined();
  });

  it('throws when total guests exceed max_occupancy', async () => {
    const peoplePerRoom: PeoplePerRoom = {
      '674377': [{ num_adults: 2, num_children: 3 }],
    };

    await expect(
      service.validateMultiRoomOccupancy(
        peoplePerRoom,
        buildRoomsInfo(),
        'hotel-uuid-1',
      ),
    ).rejects.toThrow('Total guests (5) exceeds maximum occupancy (4)');
  });

  it('throws when adults exceed max_adults', async () => {
    const roomsInfo = {
      rooms: [
        {
          room_id: '100',
          room_name: 'Suite',
          room_code: 'ST',
          max_occupancy: 6,
          max_adults: 2,
          max_children: 4,
        },
      ],
    };
    const peoplePerRoom: PeoplePerRoom = {
      '100': [{ num_adults: 3, num_children: 0 }],
    };

    await expect(
      service.validateMultiRoomOccupancy(
        peoplePerRoom,
        roomsInfo,
        'hotel-uuid-1',
      ),
    ).rejects.toThrow('Adults (3) exceeds maximum adults (2)');
  });

  it('throws when children exceed max_children', async () => {
    const peoplePerRoom: PeoplePerRoom = {
      '674378': [{ num_adults: 1, num_children: 1 }],
    };

    await expect(
      service.validateMultiRoomOccupancy(
        peoplePerRoom,
        buildRoomsInfo(),
        'hotel-uuid-1',
      ),
    ).rejects.toThrow('Children (1) exceeds maximum children (0)');
  });

  it('throws when no adult is specified for a room', async () => {
    const peoplePerRoom: PeoplePerRoom = {
      '674377': [{ num_adults: 0, num_children: 1 }],
    };

    await expect(
      service.validateMultiRoomOccupancy(
        peoplePerRoom,
        buildRoomsInfo(),
        'hotel-uuid-1',
      ),
    ).rejects.toThrow('At least one adult is required per room');
  });

  it('throws for invalid room type id', async () => {
    const peoplePerRoom: PeoplePerRoom = {
      '999999': [{ num_adults: 1, num_children: 0 }],
    };

    await expect(
      service.validateMultiRoomOccupancy(
        peoplePerRoom,
        buildRoomsInfo(),
        'hotel-uuid-1',
      ),
    ).rejects.toThrow('Invalid room type id: 999999');
  });

  it('validates each occupant group independently', async () => {
    const peoplePerRoom: PeoplePerRoom = {
      '674377': [
        { num_adults: 2, num_children: 1 },
        { num_adults: 2, num_children: 3 },
      ],
    };

    await expect(
      service.validateMultiRoomOccupancy(
        peoplePerRoom,
        buildRoomsInfo(),
        'hotel-uuid-1',
      ),
    ).rejects.toThrow('Total guests (5) exceeds maximum occupancy (4)');
  });
});

describe('CloudbedsReservationService.getRoomsInfo', () => {
  let service: CloudbedsReservationService;
  let getRoomTypesCatalogSpy: jest.SpyInstance;
  const hotel = buildHotel();

  beforeEach(() => {
    const client = new CloudbedsClient();
    service = new CloudbedsReservationService(client);
    getRoomTypesCatalogSpy = jest.spyOn(client, 'getRoomTypesCatalog');
    (hotelService.getHotelByBusinessId as jest.Mock).mockResolvedValue(hotel);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not populate max_adults/max_children from Cloudbeds adultsIncluded/childrenIncluded', async () => {
    getRoomTypesCatalogSpy.mockResolvedValue([
      {
        propertyID: 'prop-123',
        roomTypeID: '674377',
        roomTypeName: 'Deluxe Queen',
        roomTypeNameShort: 'DQ',
        roomTypeDescription: 'A deluxe queen room',
        maxGuests: 4,
        adultsIncluded: 2,
        childrenIncluded: 2,
        roomsAvailable: 3,
      },
    ]);

    const result = await service.getRoomsInfo('prop-123');

    expect(result.rooms[0]).toEqual(
      expect.objectContaining({
        room_id: '674377',
        room_name: 'Deluxe Queen',
        max_occupancy: 4,
      }),
    );
    expect(result.rooms[0].max_adults).toBeUndefined();
    expect(result.rooms[0].max_children).toBeUndefined();
  });

  it('allows any adult/child split within max_occupancy once max_adults/max_children are omitted', async () => {
    getRoomTypesCatalogSpy.mockResolvedValue([
      {
        propertyID: 'prop-123',
        roomTypeID: '674377',
        roomTypeName: 'Deluxe Queen',
        roomTypeNameShort: 'DQ',
        roomTypeDescription: 'A deluxe queen room',
        maxGuests: 4,
        adultsIncluded: 2,
        childrenIncluded: 2,
        roomsAvailable: 3,
      },
    ]);

    const roomsInfo = await service.getRoomsInfo('prop-123');
    const peoplePerRoom: PeoplePerRoom = {
      '674377': [{ num_adults: 4, num_children: 0 }],
    };

    await expect(
      service.validateMultiRoomOccupancy(
        peoplePerRoom,
        roomsInfo,
        'hotel-uuid-1',
      ),
    ).resolves.toBeUndefined();
  });
});

describe('CloudbedsReservationService.getMultiRoomAvailabilityWithQuote', () => {
  let service: CloudbedsReservationService;
  let getRoomAvailabilityWithQuoteSpy: jest.SpyInstance;
  const hotel = buildHotel();

  beforeEach(() => {
    const client = new CloudbedsClient();
    service = new CloudbedsReservationService(client);

    (
      hotelService.getHotelByAssistantPhoneNumber as jest.Mock
    ).mockResolvedValue(hotel);

    getRoomAvailabilityWithQuoteSpy = jest
      .spyOn(service, 'getRoomAvailabilityWithQuote')
      .mockResolvedValue({
        groups: [
          {
            room_id: '674377',
            room_name: 'Deluxe Queen',
            available_units: 3,
            deposit_rule_info: {},
            cancel_rule_info: {},
            pricing: {
              base_rate: 298,
              taxes: 29.8,
              fees: 0,
              total_amount: 327.8,
              amountCharged: 0,
              currency: 'USD',
              stay_dates: [],
            },
            raw_response: {} as any,
          },
        ],
        discount: null,
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('delegates to getRoomAvailabilityWithQuote with 1 adult, 0 children', async () => {
    await service.getMultiRoomAvailabilityWithQuote(
      {
        start_date: '2026-10-15',
        end_date: '2026-10-17',
        session_type: 'SMS' as any,
        booking_link: false,
      },
      '+15551234567',
      '+15551234567',
    );

    expect(getRoomAvailabilityWithQuoteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        num_adults: 1,
        num_children: 0,
        start_date: '2026-10-15',
        end_date: '2026-10-17',
      }),
      '+15551234567',
      '+15551234567',
    );
  });

  it('returns the same response structure as single-room availability', async () => {
    const result = await service.getMultiRoomAvailabilityWithQuote(
      {
        start_date: '2026-10-15',
        end_date: '2026-10-17',
        session_type: 'SMS' as any,
        booking_link: false,
      },
      '+15551234567',
      '+15551234567',
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].room_id).toBe('674377');
    expect(result.groups[0].available_units).toBe(3);
    expect(result.discount).toBeNull();
  });
});

describe('CloudbedsReservationService lite endpoints — no availability', () => {
  let service: CloudbedsReservationService;
  const hotel = buildHotel();

  beforeEach(() => {
    const client = new CloudbedsClient();
    service = new CloudbedsReservationService(client);

    (
      hotelService.getHotelByAssistantPhoneNumber as jest.Mock
    ).mockResolvedValue(hotel);

    jest
      .spyOn(service, 'getRoomAvailabilityWithQuote')
      .mockResolvedValue({ groups: [], discount: null });
    jest
      .spyOn(service, 'getRoomAvailabilityWithQuoteV2')
      .mockResolvedValue({ groups: [], discount: null });
    // Should not be reached on the empty path, but guard against real calls.
    jest
      .spyOn(service, 'getRoomsInfo')
      .mockResolvedValue({ rooms: [], note: '' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Far-future dates so validateAndCorrectDates never adjusts them (which would
  // break the date assertions below no matter when the suite runs).
  const singleParams = {
    start_date: '2099-10-15',
    end_date: '2099-10-17',
    num_adults: 2,
    num_children: 1,
    session_type: SessionType.SMS,
    booking_link: false,
  };

  const multiParams = {
    start_date: '2099-10-15',
    end_date: '2099-10-17',
    session_type: SessionType.SMS,
    booking_link: false,
  };

  it('getRoomAvailabilityWithQuoteLite returns an empty groups array with a descriptive message', async () => {
    const result = await service.getRoomAvailabilityWithQuoteLite(
      singleParams,
      '+15551234567',
      '+15551234567',
    );

    expect(result.groups).toHaveLength(0);
    expect(result.discount).toBeNull();
    expect(result.message).toContain('No rooms are available');
    expect(result.message).toContain('2 adults');
    expect(result.message).toContain('1 child');
    expect(result.message).toContain('2099-10-15');
    expect(result.message).toContain('2099-10-17');
  });

  it('getRoomAvailabilityWithQuoteLiteV2 returns an empty groups array with a descriptive message', async () => {
    const result = await service.getRoomAvailabilityWithQuoteLiteV2(
      singleParams,
      '+15551234567',
      '+15551234567',
    );

    expect(result.groups).toHaveLength(0);
    expect(result.discount).toBeNull();
    expect(result.message).toContain('No rooms are available');
  });

  it('getMultiRoomAvailabilityWithQuoteLite returns an empty groups array with a descriptive message', async () => {
    const result = await service.getMultiRoomAvailabilityWithQuoteLite(
      multiParams,
      '+15551234567',
      '+15551234567',
    );

    expect(result.groups).toHaveLength(0);
    expect(result.discount).toBeNull();
    expect(result.message).toContain('No rooms are available');
    expect(result.message).toContain('2099-10-15');
    expect(result.message).toContain('2099-10-17');
  });

  it('getMultiRoomAvailabilityWithQuoteLiteV2 returns an empty groups array with a descriptive message', async () => {
    const result = await service.getMultiRoomAvailabilityWithQuoteLiteV2(
      multiParams,
      '+15551234567',
      '+15551234567',
    );

    expect(result.groups).toHaveLength(0);
    expect(result.discount).toBeNull();
    expect(result.message).toContain('No rooms are available');
  });
});
