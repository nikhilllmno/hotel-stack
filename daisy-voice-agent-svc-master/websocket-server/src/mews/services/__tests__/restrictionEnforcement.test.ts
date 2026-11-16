jest.mock('@/mews/client/MewsClient', () => ({
  mewsClient: {
    getAllServices: jest.fn(),
    getResourceCategories: jest.fn(),
    getAvailability: jest.fn(),
    getRates: jest.fn(),
    getRestrictions: jest.fn(),
    getRatePricing: jest.fn(),
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

jest.mock('@/services/hotelConfiguration/hotelConfigurationService', () => ({
  hotelConfigurationService: {
    getHotelConfigurationByHotelId: jest.fn().mockResolvedValue(null),
  },
}));

import { Reservation as ReservationDTO } from '@/dtos/Reservation';
import { mewsClient } from '@/mews/client/MewsClient';
import { MewsRestrictedError } from '@/mews/errors';
import { MewsReservationService } from '@/mews/services/reservationService';
import {
  MewsCredentials,
  MewsRestriction,
  MewsRestrictionCondition,
  MewsService,
} from '@/mews/types';
import { Hotel } from '@/models/Hotel';
import { HotelService } from '@/services/hotel/hotelService';

const HOTEL_ID = 'hotel-1';
const SERVICE_ID = 'service-stay';
const CATEGORY_ID = 'category-king';
const RATE_ID = 'rate-standard';
const OTHER_RATE_ID = 'rate-corporate';

// Dates are derived from today so the fixtures never go stale. The service
// rejects arrivals in the past, so the whole scenario is anchored a week out.
// A single UTC anchor is captured once at module load so every derived date
// agrees even if the process happens to load across UTC midnight.
const UTC_ANCHOR = (() => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
})();

/** UTC calendar date (YYYY-MM-DD) offsetDays after the anchor. */
function isoDate(offsetDays: number): string {
  const d = new Date(UTC_ANCHOR);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** UTC midnight timestamp for the calendar date offsetDays after the anchor. */
function utcMidnight(offsetDays: number): string {
  return `${isoDate(offsetDays)}T00:00:00.000Z`;
}

const ARRIVAL_OFFSET = 7;
const CHECK_IN = isoDate(ARRIVAL_OFFSET); // arrival
const CHECK_OUT = isoDate(ARRIVAL_OFFSET + 2); // 2-night departure
const MOD_CHECK_OUT = isoDate(ARRIVAL_OFFSET + 5); // existing 5-night stay
const MOD_EXTENDED = isoDate(ARRIVAL_OFFSET + 6); // extended departure

const CREDENTIALS: MewsCredentials = {
  clientToken: 'ct',
  accessToken: 'at',
  client: 'Test 1.0.0',
};

const BOOKABLE_SERVICE = {
  Id: SERVICE_ID,
  EnterpriseId: 'enterprise-1',
  IsActive: true,
  Names: { 'en-US': 'Stay' },
  Data: { Discriminator: 'Bookable', Value: { TimeUnitPeriod: 'Day' } },
} as MewsService;

function buildHotel(): Hotel {
  return {
    id: HOTEL_ID,
    timezone: 'UTC',
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

function buildRestriction(
  conditions: Partial<MewsRestrictionCondition> = {},
): MewsRestriction {
  return {
    Id: 'restriction-1',
    ServiceId: SERVICE_ID,
    Conditions: {
      Type: 'Start',
      StartUtc: utcMidnight(ARRIVAL_OFFSET),
      EndUtc: utcMidnight(ARRIVAL_OFFSET),
      ...conditions,
    },
    Exceptions: null,
  };
}

function buildReservation(): ReservationDTO {
  return {
    id: 'reservation-1',
    booking_id: 'BK1001',
    hotel_id: HOTEL_ID,
    hotel: buildHotel(),
    room_id: CATEGORY_ID,
    room_type: 'King',
    check_in: CHECK_IN,
    check_out: CHECK_OUT,
    num_adults: 2,
    num_children: 0,
    quote: { quote_object: { rate_id: RATE_ID } },
  } as unknown as ReservationDTO;
}

beforeEach(() => {
  jest.clearAllMocks();

  (mewsClient.getAllServices as jest.Mock).mockResolvedValue([
    BOOKABLE_SERVICE,
  ]);
  (mewsClient.getResourceCategories as jest.Mock).mockResolvedValue([
    {
      Id: CATEGORY_ID,
      ServiceId: SERVICE_ID,
      IsActive: true,
      Type: 'Room',
      Names: { 'en-US': 'King' },
      ShortNames: {},
      Descriptions: {},
      Ordering: 0,
      Capacity: 2,
      ExtraCapacity: 0,
      ExternalIdentifier: null,
    },
  ]);
  (mewsClient.getAvailability as jest.Mock).mockResolvedValue({
    TimeUnitStartsUtc: [
      utcMidnight(ARRIVAL_OFFSET),
      utcMidnight(ARRIVAL_OFFSET + 1),
    ],
    ResourceCategoryAvailabilities: [
      {
        ResourceCategoryId: CATEGORY_ID,
        Metrics: { UsableResources: [5, 5], Occupied: [0, 0] },
      },
    ],
  });
  (mewsClient.getRates as jest.Mock).mockResolvedValue([
    {
      Id: RATE_ID,
      ServiceId: SERVICE_ID,
      GroupId: 'group-1',
      IsActive: true,
      IsEnabled: true,
      IsPublic: true,
      IsDefault: true,
      Names: { 'en-US': 'Standard' },
    },
    // Non-public so the listing paths still see exactly one rate, but
    // selectable by id on the modification path.
    {
      Id: OTHER_RATE_ID,
      ServiceId: SERVICE_ID,
      GroupId: 'group-1',
      IsActive: true,
      IsEnabled: true,
      IsPublic: false,
      IsDefault: false,
      Names: { 'en-US': 'Corporate' },
    },
  ]);
  (mewsClient.getAgeCategories as jest.Mock).mockResolvedValue([
    {
      Id: 'age-adult',
      ServiceId: SERVICE_ID,
      IsActive: true,
      Classification: 'Adult',
    },
  ]);
  (mewsClient.getRatePricing as jest.Mock).mockResolvedValue({
    Currency: 'USD',
    TimeUnitStartsUtc: [
      utcMidnight(ARRIVAL_OFFSET),
      utcMidnight(ARRIVAL_OFFSET + 1),
    ],
    BaseAmountPrices: [],
    CategoryPrices: [
      {
        CategoryId: CATEGORY_ID,
        AmountPrices: [
          { Currency: 'USD', NetValue: 100, GrossValue: 110, TaxValues: [] },
          { Currency: 'USD', NetValue: 100, GrossValue: 110, TaxValues: [] },
        ],
      },
    ],
  });
  (mewsClient.getRestrictions as jest.Mock).mockResolvedValue([]);
});

describe('getRoomAvailabilityWithQuote restriction filtering', () => {
  const params = {
    start_date: CHECK_IN,
    end_date: CHECK_OUT,
    num_adults: 2,
    num_children: 0,
  } as never;

  it('returns the room when nothing is restricted', async () => {
    const rooms = await makeService().getRoomAvailabilityWithQuote(
      params,
      '+15551112222',
      '+15550000001',
    );
    expect(rooms).toHaveLength(1);
    expect(rooms[0].rates).toHaveLength(1);
  });

  it('narrows the restrictions query to the stay interval', async () => {
    await makeService().getRoomAvailabilityWithQuote(
      params,
      '+15551112222',
      '+15550000001',
    );
    expect(mewsClient.getRestrictions).toHaveBeenCalledWith(
      {
        serviceIds: [SERVICE_ID],
        collidingStartUtc: utcMidnight(ARRIVAL_OFFSET),
        collidingEndUtc: utcMidnight(ARRIVAL_OFFSET + 2),
      },
      expect.anything(),
    );
  });

  it('drops a room whose only rate is closed for the arrival date', async () => {
    (mewsClient.getRestrictions as jest.Mock).mockResolvedValue([
      buildRestriction({ ExactRateId: RATE_ID }),
    ]);
    const rooms = await makeService().getRoomAvailabilityWithQuote(
      params,
      '+15551112222',
      '+15550000001',
    );
    expect(rooms).toHaveLength(0);
  });

  it('keeps the room when the restriction targets another rate', async () => {
    (mewsClient.getRestrictions as jest.Mock).mockResolvedValue([
      buildRestriction({ ExactRateId: 'rate-other' }),
    ]);
    const rooms = await makeService().getRoomAvailabilityWithQuote(
      params,
      '+15551112222',
      '+15550000001',
    );
    expect(rooms).toHaveLength(1);
  });

  it('fails open when restrictions/getAll errors', async () => {
    (mewsClient.getRestrictions as jest.Mock).mockRejectedValue(
      new Error('mews down'),
    );
    const rooms = await makeService().getRoomAvailabilityWithQuote(
      params,
      '+15551112222',
      '+15550000001',
    );
    expect(rooms).toHaveLength(1);
  });
});

describe('validateRoomAvailability restriction guard', () => {
  it('rejects a booking blocked by a restriction', async () => {
    (mewsClient.getRestrictions as jest.Mock).mockResolvedValue([
      buildRestriction({ ExactRateId: RATE_ID }),
    ]);
    await expect(
      makeService().validateRoomAvailability(
        [buildReservation()],
        CREDENTIALS,
        [BOOKABLE_SERVICE],
      ),
    ).rejects.toBeInstanceOf(MewsRestrictedError);
  });

  it('allows a booking when no restriction applies', async () => {
    await expect(
      makeService().validateRoomAvailability(
        [buildReservation()],
        CREDENTIALS,
        [BOOKABLE_SERVICE],
      ),
    ).resolves.toBeUndefined();
  });

  it('allows a booking whose stay length satisfies a MinLength exception', async () => {
    (mewsClient.getRestrictions as jest.Mock).mockResolvedValue([
      {
        ...buildRestriction({ ExactRateId: RATE_ID }),
        Exceptions: { MinLength: 'P0M2DT0H0M0S' },
      },
    ]);
    await expect(
      makeService().validateRoomAvailability(
        [buildReservation()],
        CREDENTIALS,
        [BOOKABLE_SERVICE],
      ),
    ).resolves.toBeUndefined();
  });

  it('skips the restriction check when the caller only validates a date fragment', async () => {
    (mewsClient.getRestrictions as jest.Mock).mockResolvedValue([
      buildRestriction({ ExactRateId: RATE_ID }),
    ]);
    await expect(
      makeService().validateRoomAvailability(
        [buildReservation()],
        CREDENTIALS,
        [BOOKABLE_SERVICE],
        { skipRestrictions: true },
      ),
    ).resolves.toBeUndefined();
  });
});

describe('getQuote restriction guard', () => {
  const quoteParams = {
    business_id: 'enterprise-1',
    hotel_id: HOTEL_ID,
    room_id: CATEGORY_ID,
    check_in: CHECK_IN,
    check_out: CHECK_OUT,
    num_adults: 2,
    num_children: 0,
    num_pets: 0,
  } as never;

  it('refuses to quote a restricted rate instead of leaving it to the booking guard', async () => {
    (mewsClient.getRestrictions as jest.Mock).mockResolvedValue([
      buildRestriction({ ExactRateId: RATE_ID }),
    ]);
    await expect(makeService().getQuote(quoteParams)).rejects.toBeInstanceOf(
      MewsRestrictedError,
    );
    // Rejected before pricing — the guest is never shown a number.
    expect(mewsClient.getRatePricing).not.toHaveBeenCalled();
  });

  it('quotes normally when no restriction applies', async () => {
    const quote = await makeService().getQuote(quoteParams);
    expect(quote.total_amount).toBeGreaterThan(0);
  });
});

describe('getAllRatesForRoomType restriction filtering', () => {
  const params = {
    start_date: CHECK_IN,
    end_date: CHECK_OUT,
    num_adults: 2,
    num_children: 0,
  };

  it('reads out the rate when nothing is restricted', async () => {
    const { groups } = await makeService().getAllRatesForRoomType(
      params,
      CATEGORY_ID,
      '+15551112222',
      '+15550000001',
    );
    expect(groups).toHaveLength(1);
    expect(Object.values(groups[0])[0]).toContain('Standard');
  });

  it('does not read out a restricted rate', async () => {
    (mewsClient.getRestrictions as jest.Mock).mockResolvedValue([
      buildRestriction({ ExactRateId: RATE_ID }),
    ]);
    const { groups } = await makeService().getAllRatesForRoomType(
      params,
      CATEGORY_ID,
      '+15551112222',
      '+15550000001',
    );
    expect(groups).toHaveLength(0);
  });
});

describe('getQuoteForModification restriction guard', () => {
  /** Existing five-night stay, CHECK_IN → MOD_CHECK_OUT. */
  function buildExistingReservation(): ReservationDTO {
    return {
      ...buildReservation(),
      check_in: CHECK_IN,
      check_out: MOD_CHECK_OUT,
      rate_id: RATE_ID,
      quote: undefined,
    } as unknown as ReservationDTO;
  }

  it('checks a shrink-only change, which produces no new dates to validate', async () => {
    (mewsClient.getRestrictions as jest.Mock).mockResolvedValue([
      {
        ...buildRestriction({ ExactRateId: RATE_ID }),
        Exceptions: { MinLength: 'P0M3DT0H0M0S' },
      },
    ]);
    // 5 nights down to 2 — every date is already held, so the availability
    // check has nothing to look at, but MinLength is now violated.
    await expect(
      makeService().getQuoteForModification(
        buildExistingReservation(),
        CHECK_IN,
        CHECK_OUT,
        null,
        undefined,
        undefined,
        CREDENTIALS,
        [BOOKABLE_SERVICE],
      ),
    ).rejects.toBeInstanceOf(MewsRestrictedError);
  });

  it('evaluates length against the whole new stay, not the extended fragment', async () => {
    (mewsClient.getRestrictions as jest.Mock).mockResolvedValue([
      {
        ...buildRestriction({ ExactRateId: RATE_ID }),
        Exceptions: { MinLength: 'P0M2DT0H0M0S' },
      },
    ]);
    // Extending 5 nights to 6 adds a one-night delta. Judged on the delta the
    // stay would look one night long and trip MinLength; judged whole it is 6.
    await expect(
      makeService().getQuoteForModification(
        buildExistingReservation(),
        CHECK_IN,
        MOD_EXTENDED,
        null,
        undefined,
        undefined,
        CREDENTIALS,
        [BOOKABLE_SERVICE],
      ),
    ).resolves.toBeDefined();
    // The whole new stay, not the final one-night delta.
    expect(mewsClient.getRestrictions).toHaveBeenCalledWith(
      expect.objectContaining({
        collidingStartUtc: utcMidnight(ARRIVAL_OFFSET),
        collidingEndUtc: utcMidnight(ARRIVAL_OFFSET + 6),
      }),
      expect.anything(),
    );
  });

  it('validates the rate the reservation is moving to, not the one it is on', async () => {
    (mewsClient.getRestrictions as jest.Mock).mockResolvedValue([
      buildRestriction({ ExactRateId: OTHER_RATE_ID }),
    ]);
    await expect(
      makeService().getQuoteForModification(
        buildExistingReservation(),
        CHECK_IN,
        MOD_CHECK_OUT,
        null,
        undefined,
        OTHER_RATE_ID,
        CREDENTIALS,
        [BOOKABLE_SERVICE],
      ),
    ).rejects.toBeInstanceOf(MewsRestrictedError);
  });

  it('allows a rate change to an unrestricted rate', async () => {
    (mewsClient.getRestrictions as jest.Mock).mockResolvedValue([
      buildRestriction({ ExactRateId: RATE_ID }),
    ]);
    await expect(
      makeService().getQuoteForModification(
        buildExistingReservation(),
        CHECK_IN,
        MOD_CHECK_OUT,
        null,
        undefined,
        OTHER_RATE_ID,
        CREDENTIALS,
        [BOOKABLE_SERVICE],
      ),
    ).resolves.toBeDefined();
  });
});
