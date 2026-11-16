import { Reservation as ReservationDTO } from '@/dtos/Reservation';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import { installPostgresIntegrationTestContext } from '@/test/db/createPostgresIntegrationTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import {
  defaultStayDates,
  seedReservation,
} from '@/test/fixtures/reservationSeedFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { PmsProvider } from '@/types/enums';
import { RoomReservationService } from '../roomReservationService';

const DEFAULT_SEEDED_PHONE = '+15550001111';
const ASSISTANT_PHONE = RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber;

function buildPmsReservation(
  overrides: Partial<ReservationDTO> & {
    externalId: string;
    hotelId: string;
    checkIn: string;
    checkOut: string;
  },
): ReservationDTO {
  return {
    id: 'cloudbeds-live-id-should-not-win',
    booking_id: 'PMS-BOOKING-ID-SHOULD-NOT-WIN',
    external_id: overrides.externalId,
    phone_number: DEFAULT_SEEDED_PHONE,
    type: SessionType.EXTERNAL,
    room_id: 674378,
    room_type: 'Deluxe King',
    room_name: 'DK(3)',
    room_number: '3',
    business_id: RESERVATION_FLOW_FIXTURE_IDS.businessId,
    hotel_id: overrides.hotelId,
    pms_provider: PmsProvider.CLOUDBEDS,
    status: ReservationStatus.ACTIVE,
    check_in: new Date(overrides.checkIn),
    check_out: new Date(overrides.checkOut),
    num_adults: 1,
    num_children: 0,
    customer: {
      phone_number: DEFAULT_SEEDED_PHONE,
      hotel_id: overrides.hotelId,
    },
    hotel: null,
    hotel_configuration: null,
    channel: null,
    payments: null,
    quote: null,
    discount: null,
    ...overrides,
  };
}

describe('RoomReservationService getReservationDetails merges live PMS room data onto DB-sourced results (postgres)', () => {
  const ctx = installPostgresIntegrationTestContext();
  let service: RoomReservationService;

  it('keeps the DB record identity but fills in room_name/room_number from a matching PMS phone-search result', async () => {
    const { service: testService, externalStubs } =
      createTestRoomReservationService({ knex: ctx.knex });
    service = testService;
    const { pmsReservationService } = externalStubs;

    const { checkIn, checkOut } = defaultStayDates();
    const seeded = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Peter',
      lastName: 'Parker',
      externalId: 'CB-SHARED-RES-1',
    });

    pmsReservationService.lookupReservationsByPhone.mockResolvedValueOnce([
      buildPmsReservation({
        externalId: 'CB-SHARED-RES-1',
        hotelId: seeded.hotelId,
        checkIn,
        checkOut,
      }),
    ]);

    const results = await service.getReservationDetails(
      DEFAULT_SEEDED_PHONE,
      ASSISTANT_PHONE,
    );

    expect(results).toHaveLength(1);
    // The DB record's own identity/fields win — this is unchanged behavior.
    expect(results[0].id).toBe(seeded.reservationId);
    expect(results[0].booking_id).toBe(seeded.bookingId);
    // But room_name/room_number — which the reservations table has no
    // columns for — now come from the matching live PMS result.
    expect(results[0].room_name).toBe('DK(3)');
    expect(results[0].room_number).toBe('3');
  });

  it('still fills in room_name/room_number via a by-ID refresh when the PMS has no phone-search capability at all (e.g. Cloudbeds)', async () => {
    const { service: testService, externalStubs } =
      createTestRoomReservationService({ knex: ctx.knex });
    service = testService;
    const { pmsReservationService } = externalStubs;

    const { checkIn, checkOut } = defaultStayDates();
    const seeded = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Peter',
      lastName: 'Parker',
      externalId: 'CB-NO-PHONE-SEARCH-RES-1',
    });
    // The by-ID refresh only runs for Cloudbeds hotels (every other
    // provider's own phone search already works, so it would just be a
    // wasted extra call) — the default test hotel fixture is RESNEXUS, so
    // flip it to Cloudbeds for this test specifically.
    await ctx
      .knex('hotels')
      .where({ id: seeded.hotelId })
      .update({ pms_provider: PmsProvider.CLOUDBEDS });

    // Cloudbeds' real implementation throws for phone search — simulate
    // that exactly, rather than just returning an empty array.
    pmsReservationService.lookupReservationsByPhone.mockRejectedValueOnce(
      new Error('CloudBeds: lookupReservationsByPhone not implemented'),
    );
    // The by-ID lookup (what refreshDbResultsWithLiveRoomData calls,
    // using the DB row's own stored external_id) is what Cloudbeds
    // actually supports.
    pmsReservationService.lookupReservationsById.mockResolvedValueOnce([
      buildPmsReservation({
        externalId: 'CB-NO-PHONE-SEARCH-RES-1',
        hotelId: seeded.hotelId,
        checkIn,
        checkOut,
      }),
    ]);

    const results = await service.getReservationDetails(
      DEFAULT_SEEDED_PHONE,
      ASSISTANT_PHONE,
    );

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(seeded.reservationId);
    expect(results[0].booking_id).toBe(seeded.bookingId);
    expect(results[0].room_name).toBe('DK(3)');
    expect(results[0].room_number).toBe('3');
    expect(pmsReservationService.lookupReservationsById).toHaveBeenCalledWith(
      expect.anything(),
      'CB-NO-PHONE-SEARCH-RES-1',
    );
  });

  it('fills in room_name/room_number via a by-ID refresh for a guest_name lookup on Cloudbeds', async () => {
    const { service: testService, externalStubs } =
      createTestRoomReservationService({ knex: ctx.knex });
    service = testService;
    const { pmsReservationService } = externalStubs;

    const { checkIn, checkOut } = defaultStayDates();
    const seeded = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Peter',
      lastName: 'Parker',
      externalId: 'CB-GUEST-NAME-RES-1',
    });
    await ctx
      .knex('hotels')
      .where({ id: seeded.hotelId })
      .update({ pms_provider: PmsProvider.CLOUDBEDS });

    // The guest-name path's own live PMS name search isn't guaranteed to
    // match (and this stub is never recognized as a CloudbedsReservationService
    // instance, so that search is always skipped here regardless) — the
    // by-ID refresh, using the DB row's own stored external_id, must supply
    // room data on its own, the same way it already does for the other
    // lookup paths above.
    pmsReservationService.lookupReservationsById.mockResolvedValueOnce([
      buildPmsReservation({
        externalId: 'CB-GUEST-NAME-RES-1',
        hotelId: seeded.hotelId,
        checkIn,
        checkOut,
      }),
    ]);

    const results = await service.getReservationDetails(
      DEFAULT_SEEDED_PHONE,
      ASSISTANT_PHONE,
      undefined,
      undefined,
      'Peter Parker',
    );

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(seeded.reservationId);
    expect(results[0].booking_id).toBe(seeded.bookingId);
    expect(results[0].room_name).toBe('DK(3)');
    expect(results[0].room_number).toBe('3');
    expect(pmsReservationService.lookupReservationsById).toHaveBeenCalledWith(
      expect.anything(),
      'CB-GUEST-NAME-RES-1',
    );
  });

  it('skips the by-ID refresh entirely for a non-Cloudbeds provider whose own phone search already works', async () => {
    const { service: testService, externalStubs } =
      createTestRoomReservationService({ knex: ctx.knex });
    service = testService;
    const { pmsReservationService } = externalStubs;

    const { checkIn, checkOut } = defaultStayDates();
    const seeded = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Peter',
      lastName: 'Parker',
      externalId: 'ST-PHONE-SEARCH-WORKS-RES-1',
    });
    // StayNTouch is one of the providers lookupPmsReservationsById already
    // supports (unlike the default RESNEXUS fixture, which it skips for an
    // unrelated reason) — this is what actually proves the Cloudbeds-only
    // gate, not just a provider that was already excluded beforehand.
    await ctx
      .knex('hotels')
      .where({ id: seeded.hotelId })
      .update({ pms_provider: PmsProvider.STAYNTOUCH });

    pmsReservationService.lookupReservationsByPhone.mockResolvedValueOnce([]);

    await service.getReservationDetails(DEFAULT_SEEDED_PHONE, ASSISTANT_PHONE);

    expect(pmsReservationService.lookupReservationsById).not.toHaveBeenCalled();
  });

  it('falls back to the DB result when the live Cloudbeds refresh does not respond in time', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    try {
      const { service: testService, externalStubs } =
        createTestRoomReservationService({ knex: ctx.knex });
      service = testService;
      const { pmsReservationService } = externalStubs;

      const { checkIn, checkOut } = defaultStayDates();
      const seeded = await seedReservation(ctx.knex, {
        checkIn,
        checkOut,
        firstName: 'Peter',
        lastName: 'Parker',
        externalId: 'CB-SLOW-REFRESH-RES-1',
      });
      await ctx
        .knex('hotels')
        .where({ id: seeded.hotelId })
        .update({ pms_provider: PmsProvider.CLOUDBEDS });

      pmsReservationService.lookupReservationsByPhone.mockResolvedValueOnce([]);
      // Simulate Cloudbeds hanging — refreshDbResultsWithLiveRoomData's own
      // 5s deadline (not API_TIMEOUT's 30s) is what should end this wait.
      pmsReservationService.lookupReservationsById.mockImplementationOnce(
        () => new Promise(() => {}),
      );

      const resultsPromise = service.getReservationDetails(
        DEFAULT_SEEDED_PHONE,
        ASSISTANT_PHONE,
      );
      await jest.advanceTimersByTimeAsync(5_000);
      const results = await resultsPromise;

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(seeded.reservationId);
      expect(results[0].booking_id).toBe(seeded.bookingId);
      // No live match arrived in time, so these stay unset rather than
      // guessing — same as the "no match found" case, not an error.
      expect(results[0].room_name).toBeFalsy();
      expect(results[0].room_number).toBeFalsy();
    } finally {
      jest.useRealTimers();
    }
  });
});
