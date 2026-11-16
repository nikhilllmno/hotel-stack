process.env.STAYNTOUCH_BASE_URL = 'https://api.stayntouch.test/connect';

import { SessionType } from '@/dtos/enum/SessionType';
import { Hotel } from '@/models/Hotel';
import { GetSingleRoomAvailabilityRequestParams } from '@/models/request/availability';
import { HotelService } from '@/services/hotel/hotelService';
import { HotelConfigurationService } from '@/services/hotelConfiguration/hotelConfigurationService';
import { StayntouchReservationService } from '@/stayntouch/services/reservationService';
import { AvailabilityResponse } from '@/stayntouch/types/AvailabilityResponse';
import {
  RestrictionsResponse,
  RoomTypeRestriction,
} from '@/stayntouch/types/RestrictionsResponse';
import { Country, PaymentProvider } from '@/types/enums';

const HOTEL_ID = '11111111-1111-1111-1111-111111111111';
const ASSISTANT_PHONE = '+15559876543';
const BUSINESS_ID = '1001';

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
    room_types: {
      results: [
        {
          id: 100,
          name: 'Standard Room',
          code: 'STD',
          description: '',
          max_occupancy: 2,
          image_url: null,
          image_urls: [],
          suite: false,
          pseudo: false,
        },
        {
          id: 200,
          name: 'Deluxe Suite',
          code: 'DLX',
          description: '',
          max_occupancy: 4,
          image_url: null,
          image_urls: [],
          suite: true,
          pseudo: false,
        },
        {
          id: 4399,
          name: 'Ocean View King',
          code: 'OVK',
          description: '',
          max_occupancy: 2,
          image_url: null,
          image_urls: [],
          suite: false,
          pseudo: false,
        },
        {
          id: 2374,
          name: 'Garden Double',
          code: 'GDN',
          description: '',
          max_occupancy: 2,
          image_url: null,
          image_urls: [],
          suite: false,
          pseudo: false,
        },
        {
          id: 3269,
          name: 'Presidential Suite',
          code: 'PRS',
          description: '',
          max_occupancy: 4,
          image_url: null,
          image_urls: [],
          suite: true,
          pseudo: false,
        },
      ],
    },
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as Hotel;
}

function buildEmptyAvailability(): AvailabilityResponse {
  return { results: [], total_count: 0 };
}

function buildEmptyRoomTypeRestriction(
  roomTypeId: number,
): RoomTypeRestriction {
  return {
    room_type_id: roomTypeId,
    closed: [],
    closed_arrival: [],
    closed_departure: [],
    min_stay_through: [],
    min_length_of_stay: [],
    max_length_of_stay: [],
    min_advanced_booking: [],
    max_advanced_booking: [],
  };
}

function buildRestrictions(
  overrides: Partial<{
    roomTypeId: number;
    minStay: number;
    fromDate: string;
    toDate: string;
    field: 'min_length_of_stay' | 'min_stay_through';
  }> = {},
): RestrictionsResponse {
  const {
    roomTypeId = 100,
    minStay = 3,
    fromDate = '2027-08-01',
    toDate = '2027-08-31',
    field = 'min_length_of_stay',
  } = overrides;
  const restriction = buildEmptyRoomTypeRestriction(roomTypeId);
  restriction[field] = [
    {
      value: minStay,
      date_ranges: [{ from_date: fromDate, to_date: toDate }],
    },
  ];
  return { restrictions: [restriction] };
}

describe('StayntouchReservationService min-stay restriction handling', () => {
  let service: StayntouchReservationService;
  let mockHotelService: {
    getHotelByAssistantPhoneNumber: jest.Mock;
  };
  let mockHotelConfigurationService: {
    getHotelConfigurationByHotelId: jest.Mock;
  };
  let getAvailabilitySpy: jest.SpyInstance;
  let getRestrictionsSpy: jest.SpyInstance;

  const liteParams: GetSingleRoomAvailabilityRequestParams = {
    start_date: '2027-08-10',
    end_date: '2027-08-12',
    num_adults: 2,
    num_children: 0,
    num_pets: 0,
    session_type: SessionType.CALL,
    booking_link: false,
  };

  beforeEach(() => {
    mockHotelService = {
      getHotelByAssistantPhoneNumber: jest.fn().mockResolvedValue(buildHotel()),
    };
    mockHotelConfigurationService = {
      getHotelConfigurationByHotelId: jest.fn().mockResolvedValue(null),
    };

    service = new StayntouchReservationService(
      HOTEL_ID,
      mockHotelService as unknown as HotelService,
      mockHotelConfigurationService as unknown as HotelConfigurationService,
    );

    getAvailabilitySpy = jest
      .spyOn(service['client'], 'getAvailability')
      .mockResolvedValue(buildEmptyAvailability());

    getRestrictionsSpy = jest
      .spyOn(service['client'], 'getRoomTypeRestrictions')
      .mockResolvedValue({ restrictions: [] });
  });

  afterEach(() => {
    getAvailabilitySpy.mockRestore();
    getRestrictionsSpy.mockRestore();
  });

  it('returns min-stay description when min_length_of_stay restriction causes unavailability', async () => {
    getRestrictionsSpy.mockResolvedValue(
      buildRestrictions({ minStay: 3, field: 'min_length_of_stay' }),
    );

    const result = await service.getRoomAvailabilityWithQuoteLite(
      liteParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.groups).toHaveLength(1);
    const description = Object.values(result.groups[0])[0] as string;
    expect(description).toContain('minimum stay requirement of 3 nights');
    expect(description).toContain('Your requested stay is 2 nights');
    expect(description).toContain(
      'extend your stay from 2027-08-10 to 2027-08-13',
    );
  });

  it('returns min-stay description when min_stay_through restriction causes unavailability', async () => {
    getRestrictionsSpy.mockResolvedValue(
      buildRestrictions({ minStay: 3, field: 'min_stay_through' }),
    );

    const result = await service.getRoomAvailabilityWithQuoteLite(
      liteParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.groups).toHaveLength(1);
    const description = Object.values(result.groups[0])[0] as string;
    expect(description).toContain('minimum stay requirement of 3 nights');
    expect(description).toContain('Your requested stay is 2 nights');
    expect(description).toContain(
      'extend your stay from 2027-08-10 to 2027-08-13',
    );
  });

  it('picks the strictest value when both min_length_of_stay and min_stay_through apply', async () => {
    const restriction = buildEmptyRoomTypeRestriction(100);
    restriction.min_length_of_stay = [
      {
        value: 3,
        date_ranges: [{ from_date: '2027-08-01', to_date: '2027-08-31' }],
      },
    ];
    restriction.min_stay_through = [
      {
        value: 4,
        date_ranges: [{ from_date: '2027-08-01', to_date: '2027-08-31' }],
      },
    ];
    getRestrictionsSpy.mockResolvedValue({
      restrictions: [restriction],
    });

    const result = await service.getRoomAvailabilityWithQuoteLite(
      liteParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.groups).toHaveLength(1);
    const desc = Object.values(result.groups[0])[0] as string;
    expect(desc).toContain('minimum stay requirement of 4 nights');
    expect(desc).toContain('2027-08-14');
  });

  it('returns min-stay description for 1-night extension within threshold', async () => {
    getRestrictionsSpy.mockResolvedValue(
      buildRestrictions({ minStay: 3, field: 'min_stay_through' }),
    );

    const params = { ...liteParams, end_date: '2027-08-12' };
    const result = await service.getRoomAvailabilityWithQuoteLite(
      params,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.groups).toHaveLength(1);
    const desc = Object.values(result.groups[0])[0] as string;
    expect(desc).toContain('minimum stay requirement of 3 nights');
    expect(desc).toContain('2027-08-13');
  });

  it('returns empty groups when extension exceeds MAX_MIN_STAY_EXTENSION_NIGHTS', async () => {
    getRestrictionsSpy.mockResolvedValue(
      buildRestrictions({ minStay: 5, field: 'min_stay_through' }),
    );

    const result = await service.getRoomAvailabilityWithQuoteLite(
      liteParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.groups).toHaveLength(0);
  });

  it('returns empty groups when no restrictions exist', async () => {
    getRestrictionsSpy.mockResolvedValue({ restrictions: [] });

    const result = await service.getRoomAvailabilityWithQuoteLite(
      liteParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.groups).toHaveLength(0);
  });

  it('returns empty groups when restriction date range does not cover check-in', async () => {
    getRestrictionsSpy.mockResolvedValue(
      buildRestrictions({
        minStay: 3,
        fromDate: '2027-09-01',
        toDate: '2027-09-30',
        field: 'min_stay_through',
      }),
    );

    const result = await service.getRoomAvailabilityWithQuoteLite(
      liteParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.groups).toHaveLength(0);
  });

  it('returns empty groups when restrictions API fails', async () => {
    getRestrictionsSpy.mockRejectedValue(new Error('API timeout'));

    const result = await service.getRoomAvailabilityWithQuoteLite(
      liteParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.groups).toHaveLength(0);
  });

  it('handles multiple room type restrictions with min_stay_through', async () => {
    const restriction1 = buildEmptyRoomTypeRestriction(4399);
    restriction1.min_stay_through = [
      {
        value: 3,
        date_ranges: [{ from_date: '2027-08-01', to_date: '2027-08-31' }],
      },
    ];
    const restriction2 = buildEmptyRoomTypeRestriction(2374);
    restriction2.min_stay_through = [
      {
        value: 4,
        date_ranges: [{ from_date: '2027-08-01', to_date: '2027-08-31' }],
      },
    ];
    getRestrictionsSpy.mockResolvedValue({
      restrictions: [restriction1, restriction2],
    });

    const result = await service.getRoomAvailabilityWithQuoteLite(
      liteParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.groups).toHaveLength(2);
    const desc1 = Object.values(result.groups[0])[0] as string;
    const desc2 = Object.values(result.groups[1])[0] as string;
    expect(desc1).toContain('minimum stay requirement of 3 nights');
    expect(desc1).toContain('2027-08-13');
    expect(desc2).toContain('minimum stay requirement of 4 nights');
    expect(desc2).toContain('2027-08-14');
  });

  it('filters out room types where extension exceeds threshold in mixed results', async () => {
    const restriction1 = buildEmptyRoomTypeRestriction(100);
    restriction1.min_stay_through = [
      {
        value: 4,
        date_ranges: [{ from_date: '2027-08-01', to_date: '2027-08-31' }],
      },
    ];
    const restriction2 = buildEmptyRoomTypeRestriction(200);
    restriction2.min_stay_through = [
      {
        value: 7,
        date_ranges: [{ from_date: '2027-08-01', to_date: '2027-08-31' }],
      },
    ];
    getRestrictionsSpy.mockResolvedValue({
      restrictions: [restriction1, restriction2],
    });

    const result = await service.getRoomAvailabilityWithQuoteLite(
      liteParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.groups).toHaveLength(1);
    const desc = Object.values(result.groups[0])[0] as string;
    expect(desc).toContain('minimum stay requirement of 4 nights');
  });

  it('skips restriction when requested stay already meets min-stay', async () => {
    getRestrictionsSpy.mockResolvedValue(
      buildRestrictions({ minStay: 2, field: 'min_stay_through' }),
    );

    const result = await service.getRoomAvailabilityWithQuoteLite(
      liteParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.groups).toHaveLength(0);
  });

  it('appends min-stay descriptions for restricted rooms alongside available rooms', async () => {
    getAvailabilitySpy.mockResolvedValue({
      results: [
        {
          rate_id: 1,
          rate_code: 'BAR',
          deposit_rule_info: {},
          cancel_rule_info: {},
          room_types: [
            { id: 101, name: 'King Suite', availability: 2, adr: 200 },
          ],
        },
      ],
      total_count: 1,
    });

    const getRoomRatesSpy = jest
      .spyOn(service['client'], 'getRoomRates')
      .mockResolvedValue({
        total_stay_cost: 400,
        total_inclusive_tax: 0,
        total_exclusive_tax: 40,
        total_exclusive_tourist_tax: 0,
        stay_dates: [
          {
            date: '2027-08-10',
            rate_amount: 200,
            addon_amount: 0,
            exclusive_tax: 20,
            exclusive_tourist_tax: 0,
            inclusive_tax: 0,
            total_amount: 220,
          },
          {
            date: '2027-08-11',
            rate_amount: 200,
            addon_amount: 0,
            exclusive_tax: 20,
            exclusive_tourist_tax: 0,
            inclusive_tax: 0,
            total_amount: 220,
          },
        ],
      });

    getRestrictionsSpy.mockResolvedValue(
      buildRestrictions({
        roomTypeId: 3269,
        minStay: 3,
        field: 'min_stay_through',
      }),
    );

    const result = await service.getRoomAvailabilityWithQuoteLite(
      liteParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.groups).toHaveLength(2);
    const availableDesc = Object.values(result.groups[0])[0] as string;
    expect(availableDesc).toContain('King Suite');
    const minStayDesc = Object.values(result.groups[1])[0] as string;
    expect(minStayDesc).toContain('minimum stay requirement of 3 nights');
    expect(Object.keys(result.groups[1])[0]).toBe('Presidential Suite');
    getRoomRatesSpy.mockRestore();
  });

  it('does not duplicate min-stay for rooms already in the availability response', async () => {
    getAvailabilitySpy.mockResolvedValue({
      results: [
        {
          rate_id: 1,
          rate_code: 'BAR',
          deposit_rule_info: {},
          cancel_rule_info: {},
          room_types: [
            { id: 100, name: 'Standard Room', availability: 2, adr: 150 },
          ],
        },
      ],
      total_count: 1,
    });

    const getRoomRatesSpy = jest
      .spyOn(service['client'], 'getRoomRates')
      .mockResolvedValue({
        total_stay_cost: 300,
        total_inclusive_tax: 0,
        total_exclusive_tax: 30,
        total_exclusive_tourist_tax: 0,
        stay_dates: [
          {
            date: '2027-08-10',
            rate_amount: 150,
            addon_amount: 0,
            exclusive_tax: 15,
            exclusive_tourist_tax: 0,
            inclusive_tax: 0,
            total_amount: 165,
          },
          {
            date: '2027-08-11',
            rate_amount: 150,
            addon_amount: 0,
            exclusive_tax: 15,
            exclusive_tourist_tax: 0,
            inclusive_tax: 0,
            total_amount: 165,
          },
        ],
      });

    getRestrictionsSpy.mockResolvedValue(
      buildRestrictions({
        roomTypeId: 100,
        minStay: 3,
        field: 'min_stay_through',
      }),
    );

    const result = await service.getRoomAvailabilityWithQuoteLite(
      liteParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.groups).toHaveLength(1);
    const desc = Object.values(result.groups[0])[0] as string;
    expect(desc).toContain('Standard Room');
    expect(desc).not.toContain('minimum stay');
    getRoomRatesSpy.mockRestore();
  });

  it('handles min_stay_through with multiple date ranges (real-world pattern)', async () => {
    const restriction = buildEmptyRoomTypeRestriction(4399);
    restriction.min_stay_through = [
      {
        value: 2,
        date_ranges: [
          { from_date: '2027-08-13', to_date: '2027-08-13' },
          { from_date: '2027-08-16', to_date: '2027-08-27' },
        ],
      },
      {
        value: 3,
        date_ranges: [{ from_date: '2027-08-14', to_date: '2027-08-15' }],
      },
    ];
    getRestrictionsSpy.mockResolvedValue({
      restrictions: [restriction],
    });

    const params = {
      ...liteParams,
      start_date: '2027-08-14',
      end_date: '2027-08-15',
    };
    const result = await service.getRoomAvailabilityWithQuoteLite(
      params,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.groups).toHaveLength(1);
    const desc = Object.values(result.groups[0])[0] as string;
    expect(desc).toContain('minimum stay requirement of 3 nights');
    expect(desc).toContain('2027-08-17');
  });

  it('ignores room types with empty min_stay_through and empty min_length_of_stay', async () => {
    const restriction = buildEmptyRoomTypeRestriction(2374);
    getRestrictionsSpy.mockResolvedValue({
      restrictions: [restriction],
    });

    const result = await service.getRoomAvailabilityWithQuoteLite(
      liteParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.groups).toHaveLength(0);
  });

  it('does not match min_stay_through when restriction starts on checkout date', async () => {
    const restriction = buildEmptyRoomTypeRestriction(100);
    restriction.min_stay_through = [
      {
        value: 3,
        date_ranges: [{ from_date: '2027-08-12', to_date: '2027-08-31' }],
      },
    ];
    getRestrictionsSpy.mockResolvedValue({
      restrictions: [restriction],
    });

    const result = await service.getRoomAvailabilityWithQuoteLite(
      liteParams,
      '+15551234567',
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.groups).toHaveLength(0);
  });
});
