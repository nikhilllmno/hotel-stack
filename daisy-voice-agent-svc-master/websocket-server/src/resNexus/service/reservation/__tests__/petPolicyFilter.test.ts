/**
 * Unit tests for the pet-policy filtering logic in ResNexusService.
 *
 * Covers:
 *  1. With pets + hotel HAS pet_policy_configuration → only pet-friendly rooms returned
 *  2. With pets + hotel has NO pet_policy_configuration + flag false → all rooms returned (safe migration fallback)
 *  3. With pets + hotel has NO pet_policy_configuration + flag true → throws BadRequestError
 *  4. No pets + hotel has pet_policy_configuration → all rooms returned (filter not applied)
 *  5. Description text: when hotel has config + pets, includes "All pet friendly rooms have the pet fees pre-applied"
 *  6. With pets + hotel has config but all pets rooms have no availability → returns empty groups with pet-specific message
 */

import { SessionType } from '@/dtos/enum/SessionType';
import { HotelConfiguration } from '@/dtos/HotelConfiguration';
import { BadRequestError } from '@/errors/BadRequestError';
import { Hotel } from '@/models/Hotel';
import type { GetSingleRoomAvailabilityRequestParams } from '@/models/request/availability';
import { Country, PaymentProvider } from '@/types/enums';
import dayjs from 'dayjs';
import { ResNexusService } from '../reservationService';

// ─── Constants ────────────────────────────────────────────────────────────────

const HOTEL_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ASSISTANT_PHONE = '+15550001111';
const CALLER_PHONE = '+14083205093';
const BUSINESS_ID = '12345';
const TODAY = dayjs();
const START_DATE = TODAY.add(7, 'day').format('YYYY-MM-DD');
const END_DATE = TODAY.add(9, 'day').format('YYYY-MM-DD');

// Cave Springs pet-friendly unit group IDs
const PET_FRIENDLY_IDS = [13525, 13531, 13537, 13538, 13698];

// Rooms used in tests: two pet-friendly + one non-pet-friendly
const ROOM_PET_A = 13525;
const ROOM_PET_B = 13531;
const ROOM_NON_PET = 99999;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function buildHotel(overrides: Partial<Hotel> = {}): Hotel {
  return {
    id: HOTEL_ID,
    name: 'Cave Springs',
    business_id: BUSINESS_ID,
    pms_provider: 'resnexus',
    assistant_phone_number: ASSISTANT_PHONE,
    country: Country.US,
    timezone: 'America/Los_Angeles',
    telegram_check_in_group_id: '',
    telegram_alerts_group_id: '',
    sms_number: '',
    internal_phone_number: '',
    url: '',
    address: '',
    image_url: '',
    currency: 'USD',
    payment_provider: PaymentProvider.SHIFT4,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as Hotel;
}

function buildHotelConfig(
  overrides: Partial<HotelConfiguration> = {},
): HotelConfiguration {
  return {
    id: 1,
    hotel_id: HOTEL_ID,
    sms_agent_enabled: false,
    negative_sentiment_followup_enabled: false,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as HotelConfiguration;
}

function buildUnitGroupsResponse(ids: number[]) {
  return {
    business_id: Number(BUSINESS_ID),
    response_errors: [],
    unit_groups: ids.map((id) => ({
      unit_group_id: id,
      business_id: Number(BUSINESS_ID),
      name: `Room ${id}`,
      unit_ids: [],
      number_of_units: 5,
      description: `Description for room ${id}`,
      per_unit_capacity: 4,
      max_children: 2,
      unit_type: 'room',
    })),
  };
}

function buildCalendarResponse(ids: number[]) {
  return {
    calendars: ids.map((id) => ({
      unit_group_id: id,
      data: [
        {
          start_date: START_DATE,
          end_date: END_DATE,
          available_units: 1,
          min_stay: 1,
        },
      ],
    })),
  };
}

function buildAvailabilityResponse(ids: number[]) {
  return {
    groups: ids.map((id) => ({
      unit_group_id: id,
      unit_group_name: `Room ${id}`,
      number_of_units_available: 1,
      business_id: Number(BUSINESS_ID),
      start_date: START_DATE,
      end_date: END_DATE,
    })),
    response_errors: [],
  };
}

function buildQuoteResponse(unit_group_id: number) {
  return {
    unit_group_id,
    check_in: START_DATE,
    check_out: END_DATE,
    base_rate: 200,
    taxes: 30,
    fees: 10,
    total_amount: 240,
    amountCharged: 240,
    currency: 'USD',
    response_errors: [],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALL_ROOM_IDS = [ROOM_PET_A, ROOM_PET_B, ROOM_NON_PET];

/** Build a mock resNexusInstance.get that serves all required ResNexus endpoints. */
function buildMockResNexus(availableRoomIds = ALL_ROOM_IDS) {
  return {
    get: jest.fn((uri: string) => {
      switch (uri) {
        case 'getunitgroups':
          return Promise.resolve({
            data: buildUnitGroupsResponse(ALL_ROOM_IDS),
          });
        case 'getcalendar':
          return Promise.resolve({ data: buildCalendarResponse(ALL_ROOM_IDS) });
        case 'getAllAvailability':
          return Promise.resolve({
            data: buildAvailabilityResponse(availableRoomIds),
          });
        case 'getquote':
          return Promise.resolve({
            data: buildQuoteResponse(availableRoomIds[0] ?? ROOM_PET_A),
          });
        default:
          return Promise.reject(new Error(`Unexpected ResNexus URI: ${uri}`));
      }
    }),
  };
}

function buildAvailabilityParams(
  overrides: Partial<GetSingleRoomAvailabilityRequestParams> = {},
): GetSingleRoomAvailabilityRequestParams {
  return {
    start_date: START_DATE,
    end_date: END_DATE,
    num_adults: 2,
    session_type: SessionType.CALL,
    booking_link: false,
    ...overrides,
  };
}

/** Build a fully-wired ResNexusService with injectable mocks. */
function buildService({
  hotel = buildHotel(),
  hotelConfig = buildHotelConfig(),
  petPolicyFilterEnabled = false,
  availableRoomIds = ALL_ROOM_IDS,
}: {
  hotel?: Hotel;
  hotelConfig?: HotelConfiguration | null;
  petPolicyFilterEnabled?: boolean;
  availableRoomIds?: number[];
} = {}) {
  const mockResNexusInstance = buildMockResNexus(availableRoomIds);

  const mockHotelService = {
    getHotelByAssistantPhoneNumber: jest.fn().mockResolvedValue(hotel),
  };

  const mockHotelConfigService = {
    getHotelConfigurationByHotelId: jest.fn().mockResolvedValue(hotelConfig),
  };

  const mockDiscountService = {
    getUnusedDiscountByPhoneNumberAndHotelId: jest.fn().mockResolvedValue(null),
  };

  // Override the PET_POLICY_FILTER_ENABLED flag on the imported config singleton.
  // Safe to mutate since Jest isolates module state per test file.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cfg = require('@/config').default;
  cfg.PET_POLICY_FILTER_ENABLED = petPolicyFilterEnabled;
  cfg.CAPE_COLLECTION_HOTEL_IDS = cfg.CAPE_COLLECTION_HOTEL_IDS ?? [];
  cfg.RESNEXUS_TEST_BUSINESS_ID = null;
  cfg.RESNEXUS_TEST_MODE = null;

  const service = new ResNexusService(
    mockResNexusInstance as any,
    mockHotelService as any,
    mockHotelConfigService as any,
    mockDiscountService as any,
  );

  return {
    service,
    mockResNexusInstance,
    mockHotelService,
    mockHotelConfigService,
    mockDiscountService,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ResNexusService — pet policy filtering', () => {
  // ── Scenario 1 ───────────────────────────────────────────────────────────────
  it('filters to pet-friendly rooms only when hotel has pet_policy_configuration and num_pets > 0', async () => {
    const { service } = buildService({
      hotelConfig: buildHotelConfig({
        pet_policy_configuration: {
          pet_friendly_unit_group_ids: PET_FRIENDLY_IDS,
        },
      }),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await service.getRoomAvailabilityWithQuoteLite(
      buildAvailabilityParams({ num_pets: 1 }),
      CALLER_PHONE,
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    const returnedKeys = result.groups.flatMap((g: Record<string, unknown>) =>
      Object.keys(g),
    );
    // Room 99999 ("Room 99999") must not appear; only pet-friendly rooms
    expect(returnedKeys).not.toContain(`Room ${ROOM_NON_PET}`);
    // At least one pet-friendly room must be present
    const petRoomKeys = returnedKeys.filter(
      (k: string) => k === `Room ${ROOM_PET_A}` || k === `Room ${ROOM_PET_B}`,
    );
    expect(petRoomKeys.length).toBeGreaterThan(0);
  });

  // ── Scenario 2 ───────────────────────────────────────────────────────────────
  it('returns all rooms when hotel has NO pet_policy_configuration and flag is false (safe migration fallback)', async () => {
    const { service } = buildService({
      hotelConfig: buildHotelConfig({ pet_policy_configuration: null }),
      petPolicyFilterEnabled: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await service.getRoomAvailabilityWithQuoteLite(
      buildAvailabilityParams({ num_pets: 1 }),
      CALLER_PHONE,
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    const returnedKeys = result.groups.flatMap((g: Record<string, unknown>) =>
      Object.keys(g),
    );
    // All 3 rooms must be present — filter not applied
    expect(returnedKeys).toContain(`Room ${ROOM_PET_A}`);
    expect(returnedKeys).toContain(`Room ${ROOM_PET_B}`);
    expect(returnedKeys).toContain(`Room ${ROOM_NON_PET}`);
  });

  // ── Scenario 3 ───────────────────────────────────────────────────────────────
  it('throws BadRequestError when hotel has NO pet_policy_configuration and flag is true', async () => {
    const { service } = buildService({
      hotelConfig: buildHotelConfig({ pet_policy_configuration: null }),
      petPolicyFilterEnabled: true,
    });

    await expect(
      service.getRoomAvailabilityWithQuoteLite(
        buildAvailabilityParams({ num_pets: 1 }),
        CALLER_PHONE,
        ASSISTANT_PHONE,
        SessionType.CALL,
      ),
    ).rejects.toThrow(BadRequestError);
  });

  // ── Scenario 4 ───────────────────────────────────────────────────────────────
  it('returns all rooms when num_pets is 0 even if hotel has pet_policy_configuration', async () => {
    const { service } = buildService({
      hotelConfig: buildHotelConfig({
        pet_policy_configuration: {
          pet_friendly_unit_group_ids: PET_FRIENDLY_IDS,
        },
      }),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await service.getRoomAvailabilityWithQuoteLite(
      buildAvailabilityParams({ num_pets: 0 }),
      CALLER_PHONE,
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    const returnedKeys = result.groups.flatMap((g: Record<string, unknown>) =>
      Object.keys(g),
    );
    // All 3 rooms must appear — num_pets=0 bypasses the filter entirely
    expect(returnedKeys).toContain(`Room ${ROOM_PET_A}`);
    expect(returnedKeys).toContain(`Room ${ROOM_PET_B}`);
    expect(returnedKeys).toContain(`Room ${ROOM_NON_PET}`);
  });

  // ── Scenario 5 ───────────────────────────────────────────────────────────────
  it('appends "All pet friendly rooms have the pet fees pre-applied" to description when hotel has config and num_pets > 0', async () => {
    const { service } = buildService({
      hotelConfig: buildHotelConfig({
        pet_policy_configuration: {
          pet_friendly_unit_group_ids: PET_FRIENDLY_IDS,
        },
      }),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await service.getRoomAvailabilityWithQuoteLite(
      buildAvailabilityParams({ num_pets: 1 }),
      CALLER_PHONE,
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    const descriptions = result.groups
      .flatMap((g: Record<string, unknown>) => Object.values(g))
      .filter((v: unknown) => typeof v === 'string') as string[];
    expect(descriptions.length).toBeGreaterThan(0);
    descriptions.forEach((desc) => {
      expect(desc).toContain(
        'All pet friendly rooms have the pet fees pre-applied',
      );
    });
  });

  // ── Scenario 6 ───────────────────────────────────────────────────────────────
  it('returns empty groups with a pet-specific message when all pet-friendly rooms are unavailable', async () => {
    // Only ROOM_NON_PET is available — all pet-friendly rooms have no availability
    const { service } = buildService({
      hotelConfig: buildHotelConfig({
        pet_policy_configuration: {
          pet_friendly_unit_group_ids: PET_FRIENDLY_IDS,
        },
      }),
      availableRoomIds: [ROOM_NON_PET], // only non-pet room available
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await service.getRoomAvailabilityWithQuoteLite(
      buildAvailabilityParams({ num_pets: 1 }),
      CALLER_PHONE,
      ASSISTANT_PHONE,
      SessionType.CALL,
    );

    expect(result.groups).toHaveLength(0);
    expect(result.message).toMatch(/no pet-friendly rooms/i);
  });
});
