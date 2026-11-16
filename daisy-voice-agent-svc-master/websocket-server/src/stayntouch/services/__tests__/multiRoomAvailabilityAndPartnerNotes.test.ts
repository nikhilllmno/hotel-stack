process.env.STAYNTOUCH_BASE_URL = 'https://api.stayntouch.test/connect';

import { SessionType } from '@/dtos/enum/SessionType';
import { Hotel } from '@/models/Hotel';
import { GetAvailabilityRequestParams } from '@/models/request/availability';
import { HotelService } from '@/services/hotel/hotelService';
import { HotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import { StayntouchReservationService } from '@/stayntouch/services/reservationService';
import { AvailabilityResponse } from '@/stayntouch/types/AvailabilityResponse';
import { RoomRatesResponse } from '@/stayntouch/types/RoomRatesResponse';
import { Country, PaymentProvider } from '@/types/enums';

const HOTEL_ID = '11111111-1111-1111-1111-111111111111';
const ASSISTANT_PHONE = '+15559876543';
const BUSINESS_ID = '1001';
const START_DATE = '2027-06-15';
const END_DATE = '2027-06-17';

const availabilityParams: GetAvailabilityRequestParams = {
  start_date: START_DATE,
  end_date: END_DATE,
  session_type: SessionType.CALL,
  booking_link: false,
  num_pets: 0,
};

function buildHotel(overrides: Partial<Hotel> = {}): Hotel {
  return {
    id: HOTEL_ID,
    name: 'Test StayNTouch Hotel',
    business_id: BUSINESS_ID,
    pms_provider: 'stayntouch',
    assistant_phone_number: ASSISTANT_PHONE,
    country: Country.US,
    timezone: 'America/New_York',
    telegram_check_in_group_id: 'group-1',
    telegram_alerts_group_id: 'group-2',
    sms_number: '+15559876543',
    internal_phone_number: '+15559876544',
    url: 'https://hotel.test',
    address: '1 Test St',
    image_url: 'https://hotel.test/image.png',
    currency: 'USD',
    payment_provider: PaymentProvider.SHIFT4,
    created_at: new Date(),
    updated_at: new Date(),
    room_types: {
      results: [
        {
          id: 101,
          name: 'King Suite',
          code: 'KNG',
          description: 'Spacious king suite',
          max_occupancy: 4,
          image_url: null,
          image_urls: [],
          suite: true,
          pseudo: false,
        },
        {
          id: 102,
          name: 'Standard Double',
          code: 'DBL',
          description: 'Standard double room',
          max_occupancy: 2,
          image_url: null,
          image_urls: [],
          suite: false,
          pseudo: false,
        },
      ],
    },
    ...overrides,
  } as Hotel;
}

function buildAvailabilityResponse(): AvailabilityResponse {
  return {
    total_count: 2,
    results: [
      {
        rate_id: 1,
        rate_code: 'BAR',
        deposit_rule_info: {
          id: 1,
          name: 'Standard Deposit',
          description: 'One night deposit',
        },
        cancel_rule_info: {
          id: 1,
          name: 'Flexible',
          description: 'Cancel 24h before',
        },
        room_types: [
          { id: 101, name: 'King Suite', availability: 2, adr: 225 },
          { id: 102, name: 'Standard Double', availability: 1, adr: 150 },
        ],
      },
      {
        rate_id: 99,
        rate_code: 'CORP',
        deposit_rule_info: {},
        cancel_rule_info: {},
        room_types: [
          { id: 101, name: 'King Suite', availability: 2, adr: 200 },
        ],
      },
    ],
  };
}

function buildRoomRatesResponse(): RoomRatesResponse {
  return {
    total_stay_cost: 450,
    total_inclusive_tax: 0,
    total_exclusive_tax: 45,
    total_exclusive_tourist_tax: 0,
    stay_dates: [
      {
        date: '2027-06-15',
        rate_amount: 200,
        addon_amount: 5,
        exclusive_tax: 22.5,
        exclusive_tourist_tax: 0,
        inclusive_tax: 0,
        total_amount: 227.5,
      },
      {
        date: '2027-06-16',
        rate_amount: 200,
        addon_amount: 5,
        exclusive_tax: 22.5,
        exclusive_tourist_tax: 0,
        inclusive_tax: 0,
        total_amount: 227.5,
      },
    ],
  };
}

describe('StayntouchReservationService multi-room availability', () => {
  let service: StayntouchReservationService;
  let mockHotelService: {
    getHotelByAssistantPhoneNumber: jest.Mock;
    getHotelByBusinessId: jest.Mock;
  };
  let mockHotelConfigurationService: {
    getHotelConfigurationByHotelId: jest.Mock;
  };
  let getAvailabilitySpy: jest.SpyInstance;
  let getRoomRatesSpy: jest.SpyInstance;

  beforeEach(() => {
    mockHotelService = {
      getHotelByAssistantPhoneNumber: jest.fn(),
      getHotelByBusinessId: jest.fn(),
    };
    mockHotelConfigurationService = {
      getHotelConfigurationByHotelId: jest.fn(),
    };

    service = new StayntouchReservationService(
      HOTEL_ID,
      mockHotelService as unknown as HotelService,
      mockHotelConfigurationService as unknown as HotelConfigurationService,
    );

    const hotel = buildHotel();
    mockHotelService.getHotelByAssistantPhoneNumber.mockResolvedValue(hotel);
    mockHotelService.getHotelByBusinessId.mockResolvedValue(hotel);
    mockHotelConfigurationService.getHotelConfigurationByHotelId.mockResolvedValue(
      {
        rate_code_config: { allowed: ['BAR'] },
      },
    );

    getAvailabilitySpy = jest
      .spyOn(service['client'], 'getAvailability')
      .mockResolvedValue(buildAvailabilityResponse());

    getRoomRatesSpy = jest
      .spyOn(service['client'], 'getRoomRates')
      .mockResolvedValue(buildRoomRatesResponse());
  });

  afterEach(() => {
    getAvailabilitySpy.mockRestore();
    getRoomRatesSpy.mockRestore();
  });

  it('probes StayNTouch availability with one adult per room (ResNexus-style catalog)', async () => {
    await service.getMultiRoomAvailabilityWithQuote(
      availabilityParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(getAvailabilitySpy).toHaveBeenCalledWith(BUSINESS_ID, {
      from_date: START_DATE,
      to_date: END_DATE,
      adults: 1,
      children: 0,
    });
  });

  it('fetches room rates with one adult when building multi-room quotes', async () => {
    await service.getMultiRoomAvailabilityWithQuote(
      availabilityParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(getRoomRatesSpy).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({
        adults: 1,
        children: 0,
        rate_id: 1,
        room_type_id: 101,
      }),
    );
  });

  it('returns structured groups with pricing for allowed rate codes only (full)', async () => {
    const result = await service.getMultiRoomAvailabilityWithQuote(
      availabilityParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.discount).toBeNull();
    expect(result.groups).toHaveLength(2);

    const kingSuite = result.groups.find(
      (g: { room_id: number }) => g.room_id === 101,
    );
    expect(kingSuite).toMatchObject({
      room_name: 'King Suite',
      description: 'Spacious king suite',
      max_occupancy: 4,
      available_units: 2,
    });
    expect(kingSuite.rates).toHaveLength(1);
    expect(kingSuite.rates[0]).toMatchObject({
      rate_code: 'BAR',
      base_rate: expect.any(Number),
      total_amount: expect.any(Number),
      amount_charged: expect.any(Number),
      pricing: expect.objectContaining({ total_stay_cost: 450 }),
    });

    // CORP rate should be filtered out by allowed-rate-code config
    expect(
      result.groups.every((g: { rates: { rate_code: string }[] }) =>
        g.rates.every((rate) => rate.rate_code === 'BAR'),
      ),
    ).toBe(true);
  });

  it('returns empty groups when StayNTouch reports no availability', async () => {
    getAvailabilitySpy.mockResolvedValue({ results: [], total_count: 0 });

    const result = await service.getMultiRoomAvailabilityWithQuote(
      availabilityParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result).toEqual({ groups: [], discount: null });
    expect(getRoomRatesSpy).not.toHaveBeenCalled();
  });

  it('returns natural-language descriptions keyed by room name (lite)', async () => {
    const result = await service.getMultiRoomAvailabilityWithQuoteLite(
      availabilityParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.discount).toBeNull();
    expect(result.groups).toHaveLength(2);

    const kingSuiteEntry = result.groups.find(
      (g: Record<string, string>) => g['King Suite'] != null,
    );
    expect(kingSuiteEntry['King Suite']).toContain('room_id: 101');
    expect(kingSuiteEntry['King Suite']).toContain('2 units are available');
    expect(kingSuiteEntry['King Suite']).toContain(
      'You cannot book beyond the 2 available units.',
    );
    expect(kingSuiteEntry['King Suite']).toContain(
      'prices shown are for one adult',
    );
    expect(kingSuiteEntry['King Suite']).toContain('Rate code BAR');
    expect(kingSuiteEntry['King Suite']).toContain(
      'maximum occupancy of the room is 4 people',
    );

    const standardDoubleEntry = result.groups.find(
      (g: Record<string, string>) => g['Standard Double'] != null,
    );
    expect(standardDoubleEntry['Standard Double']).toContain('room_id: 102');
    expect(standardDoubleEntry['Standard Double']).toContain(
      '1 unit is available',
    );
    expect(standardDoubleEntry['Standard Double']).toContain(
      'You cannot book beyond the 1 available unit.',
    );
    expect(standardDoubleEntry['Standard Double']).toContain(
      'maximum occupancy of the room is 2 people',
    );
  });

  it('appends pet-fee note in lite response when num_pets > 0', async () => {
    jest.spyOn(service as any, 'fetchPetFeeAddon').mockResolvedValue({
      id: 99,
      name: 'Pet Fee',
      amount: 25,
      amount_type: 'FLAT',
    });

    const result = await service.getMultiRoomAvailabilityWithQuoteLite(
      { ...availabilityParams, num_pets: 1 },
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    const kingSuiteEntry = result.groups.find(
      (g: Record<string, string>) => g['King Suite'] != null,
    );
    expect(kingSuiteEntry['King Suite']).toContain(
      'All amounts have the pet fees pre-applied.',
    );
  });
});

describe('StayntouchReservationService.validateRoomAvailability', () => {
  let service: StayntouchReservationService;
  let getAvailabilitySpy: jest.SpyInstance;

  beforeEach(() => {
    service = new StayntouchReservationService(HOTEL_ID);
    getAvailabilitySpy = jest
      .spyOn(service['client'], 'getAvailability')
      .mockResolvedValue(buildAvailabilityResponse());
  });

  afterEach(() => {
    getAvailabilitySpy.mockRestore();
  });

  it('checks availability for the quoted rate only, not the sum across rates', async () => {
    const reservations = [
      {
        room_id: 101,
        room_type: 'King Suite',
        business_id: BUSINESS_ID,
        hotel: { id: HOTEL_ID },
        check_in: new Date('2027-06-15'),
        check_out: new Date('2027-06-17'),
        num_adults: 2,
        num_children: 0,
        rate_code: 'CORP',
        quote: {
          quote_object: { raw_response: { rate_id: 99, rate_code: 'CORP' } },
        },
      },
      {
        room_id: 101,
        room_type: 'King Suite',
        business_id: BUSINESS_ID,
        hotel: { id: HOTEL_ID },
        check_in: new Date('2027-06-15'),
        check_out: new Date('2027-06-17'),
        num_adults: 2,
        num_children: 0,
        rate_code: 'CORP',
        quote: {
          quote_object: { raw_response: { rate_id: 99, rate_code: 'CORP' } },
        },
      },
    ];

    // CORP has availability 2; BAR also has 2 — summed would incorrectly allow 3+
    await expect(
      service.validateRoomAvailability(reservations as any),
    ).resolves.toBeUndefined();

    await expect(
      service.validateRoomAvailability([
        ...reservations,
        { ...reservations[0] },
      ] as any),
    ).rejects.toThrow(
      'King Suite is no longer available for the selected dates',
    );
  });

  describe('pre-create validation (rate_code from request, no quote yet)', () => {
    it('fails when rate_code is missing on reservation data', async () => {
      const reservationsWithoutRate = [
        {
          room_id: 101,
          room_type: 'King Suite',
          business_id: BUSINESS_ID,
          hotel: { id: HOTEL_ID },
          check_in: new Date('2027-06-15'),
          check_out: new Date('2027-06-17'),
          num_adults: 2,
          num_children: 0,
        },
      ];

      await expect(
        service.validateRoomAvailability(reservationsWithoutRate as any),
      ).rejects.toThrow(
        'King Suite is no longer available for the selected dates',
      );
    });

    it('passes when rest.rate_code is copied onto reservation data before validation', async () => {
      const reservationsWithRate = [
        {
          room_id: 101,
          room_type: 'King Suite',
          business_id: BUSINESS_ID,
          hotel: { id: HOTEL_ID },
          check_in: new Date('2027-06-15'),
          check_out: new Date('2027-06-17'),
          num_adults: 2,
          num_children: 0,
          rate_code: 'BAR',
        },
      ];

      await expect(
        service.validateRoomAvailability(reservationsWithRate as any),
      ).resolves.toBeUndefined();
    });

    it('passes for multi-room bookings when each reservation has the same rate_code', async () => {
      const multiRoomReservations = [
        {
          room_id: 101,
          room_type: 'King Suite',
          business_id: BUSINESS_ID,
          hotel: { id: HOTEL_ID },
          check_in: new Date('2027-06-15'),
          check_out: new Date('2027-06-17'),
          num_adults: 2,
          num_children: 0,
          rate_code: 'BAR',
        },
        {
          room_id: 101,
          room_type: 'King Suite',
          business_id: BUSINESS_ID,
          hotel: { id: HOTEL_ID },
          check_in: new Date('2027-06-15'),
          check_out: new Date('2027-06-17'),
          num_adults: 2,
          num_children: 0,
          rate_code: 'BAR',
        },
      ];

      await expect(
        service.validateRoomAvailability(multiRoomReservations as any),
      ).resolves.toBeUndefined();
    });
  });
});
