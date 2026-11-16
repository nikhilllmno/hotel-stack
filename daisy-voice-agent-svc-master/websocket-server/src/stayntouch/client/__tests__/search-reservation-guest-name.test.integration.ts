import { Reservation as ReservationDTO } from '@/dtos/Reservation';
import { PMSServiceFactory } from '@/pms/PMSServiceFactory';
import { RoomReservationService } from '@/services/roomReservation/roomReservationService';
import { searchReservationByGuestName } from '@/stayntouch/client/search-reservation-guest-name';
import { StayntouchReservationService } from '@/stayntouch/services/reservationService';
import { installPostgresIntegrationTestContext } from '@/test/db/createPostgresIntegrationTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import {
  defaultStayDates,
  OTHER_HOTEL_ID,
  seedOtherHotel,
  seedReservation,
} from '@/test/fixtures/reservationSeedFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { PmsProvider } from '@/types/enums';
import { withTimeoutWithFallback } from '@/utils/async';
import dayjs from 'dayjs';

const UNMATCHED_CALLER_PHONE = '+15559876543';
const PMS_LOOKUP_TEST_TIMEOUT_MS = 1;

function createNeverResolvingPromise<T>(): Promise<T> {
  return new Promise(() => {});
}

function mockTimedOutPmsGuestLookup(
  stayntouchService: StayntouchReservationService,
): jest.SpyInstance {
  return jest
    .spyOn(stayntouchService, 'lookupReservationsByGuestQueryFromPms')
    .mockImplementation(
      (_hotel, _guestName, timeoutMs = PMS_LOOKUP_TEST_TIMEOUT_MS) =>
        withTimeoutWithFallback(
          () => createNeverResolvingPromise<ReservationDTO[]>(),
          timeoutMs,
          [],
        ),
    );
}

function mockTimedOutPmsPhoneLookup(
  stayntouchService: StayntouchReservationService,
): jest.SpyInstance {
  return jest
    .spyOn(stayntouchService, 'lookupReservationsByPhone')
    .mockImplementation(() => createNeverResolvingPromise<ReservationDTO[]>());
}

function mockTimedOutPmsPhoneLookupAtServiceLevel(
  service: RoomReservationService,
): jest.SpyInstance {
  type LookupPmsReservationsByPhone = (
    assistantPhoneNumber: string,
    phoneNumber: string,
    maxResults: number | undefined,
    timeoutMs: number,
  ) => Promise<ReservationDTO[]>;

  const serviceRecord = service as unknown as {
    lookupPmsReservationsByPhone: LookupPmsReservationsByPhone;
  };
  const lookupPmsReservationsByPhone =
    serviceRecord.lookupPmsReservationsByPhone.bind(service);

  return jest
    .spyOn(serviceRecord, 'lookupPmsReservationsByPhone')
    .mockImplementation((assistantPhoneNumber, phoneNumber, maxResults) =>
      lookupPmsReservationsByPhone(
        assistantPhoneNumber,
        phoneNumber,
        maxResults,
        PMS_LOOKUP_TEST_TIMEOUT_MS,
      ),
    );
}

interface FuzzyMatchBoundarySet {
  name: string;
  matches: string[];
  nonMatches: string[];
}

const FUZZY_MATCH_BOUNDARY_SETS: FuzzyMatchBoundarySet[] = [
  {
    name: 'Karl Smith',
    matches: ['Carl Smith', 'Karl Smth', 'Smith Karl', 'Smyth Carl'],
    nonMatches: [
      'Carl Schmidt',
      'Carl Jones',
      'Jane Smikk',
      'Jane Foobar',
      'Jane Smith',
      'Karl Foobar',
      'Smyth Foobar',
    ],
  },
  {
    name: 'Shuan Smith',
    matches: ['Sean Smith', 'Shawn Smith'],
    nonMatches: ['Shuan Foobar', 'Shaun Arnold'],
  },
  {
    name: 'Steven Clark',
    matches: ['Stephen Clark', 'Stefan Clark'],
    nonMatches: [
      'Steven Foobar',
      'Stephen Jones',
      'Steven Jackson',
      'Stephen Schmidt',
    ],
  },
  {
    name: 'Catherine Lee',
    matches: ['Catharine Lee', 'Katherine Lee'],
    nonMatches: [
      'Catherine Foobar',
      'Catherine Jones',
      'Catherine Schmidt',
      'Kathryn Jones',
    ],
  },
  {
    name: 'Kathryn Lee',
    matches: ['Kathrynne Lee', 'Kathrine Lee'],
    nonMatches: [
      'Kathryn Foobar',
      'Kathryn Jones',
      'Kathryn Schmidt',
      'Catherine Foobar',
      'Catherine Jones',
    ],
  },
  {
    name: 'Scott Arnold',
    matches: ['Scott Arnold', 'Arnold Scott', 'Skott Arnold'],
    nonMatches: ['Kathryn Foobar', 'Kathryn Jones'],
  },
];

describe('searchReservationByGuestName integration (postgres)', () => {
  const ctx = installPostgresIntegrationTestContext();

  it('returns no results when no guest names are similar enough', async () => {
    const { checkIn, checkOut } = defaultStayDates();

    await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Jane',
      lastName: 'Foobar',
    });

    const results = await searchReservationByGuestName({
      hotelId: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      name: 'Karl Smith',
    });

    expect(results).toHaveLength(0);
  });

  it('returns all matching reservations when total count is five or fewer', async () => {
    const recentStay = defaultStayDates();
    const staleCheckIn = dayjs().subtract(14, 'day').format('YYYY-MM-DD');
    const staleCheckOut = dayjs().subtract(10, 'day').format('YYYY-MM-DD');

    const karlSmithRecent = await seedReservation(ctx.knex, {
      ...recentStay,
      firstName: 'Karl',
      lastName: 'Smith',
    });
    const karlSmithStale = await seedReservation(ctx.knex, {
      checkIn: staleCheckIn,
      checkOut: staleCheckOut,
      firstName: 'Karl',
      lastName: 'Smith',
    });
    const carlSmith = await seedReservation(ctx.knex, {
      ...recentStay,
      firstName: 'Carl',
      lastName: 'Smith',
    });
    await seedReservation(ctx.knex, {
      ...recentStay,
      firstName: 'Jane',
      lastName: 'Foobar',
    });

    const results = await searchReservationByGuestName({
      hotelId: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      name: 'Karl Smith',
    });

    expect(results).toHaveLength(3);
    expect(results.map((reservation) => reservation.booking_id).sort()).toEqual(
      [
        karlSmithRecent.bookingId,
        karlSmithStale.bookingId,
        carlSmith.bookingId,
      ].sort(),
    );
  });

  it('returns reservations from the top three similarity tiers, including ties', async () => {
    const recentStay = defaultStayDates();

    const karlSmithOne = await seedReservation(ctx.knex, {
      ...recentStay,
      firstName: 'Karl',
      lastName: 'Smith',
    });
    const karlSmithTwo = await seedReservation(ctx.knex, {
      checkIn: dayjs().add(5, 'day').format('YYYY-MM-DD'),
      checkOut: dayjs().add(7, 'day').format('YYYY-MM-DD'),
      firstName: 'Karl',
      lastName: 'Smith',
    });
    const carlSmith = await seedReservation(ctx.knex, {
      ...recentStay,
      firstName: 'Carl',
      lastName: 'Smith',
    });
    const karlSmyth = await seedReservation(ctx.knex, {
      ...recentStay,
      firstName: 'Karl',
      lastName: 'Smyth',
    });
    const carlSmyth = await seedReservation(ctx.knex, {
      ...recentStay,
      firstName: 'Carl',
      lastName: 'Smyth',
    });
    const carlSmythTwo = await seedReservation(ctx.knex, {
      checkIn: dayjs().add(8, 'day').format('YYYY-MM-DD'),
      checkOut: dayjs().add(10, 'day').format('YYYY-MM-DD'),
      firstName: 'Carl',
      lastName: 'Smyth',
    });

    const results = await searchReservationByGuestName({
      hotelId: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      name: 'Karl Smith',
    });

    expect(results).toHaveLength(6);
    expect(results.map((reservation) => reservation.booking_id).sort()).toEqual(
      [
        karlSmithOne.bookingId,
        karlSmithTwo.bookingId,
        carlSmith.bookingId,
        karlSmyth.bookingId,
        carlSmyth.bookingId,
        carlSmythTwo.bookingId,
      ].sort(),
    );
  });

  it('filters stale reservations by check_out when more than five matches exist', async () => {
    const recentStay = defaultStayDates();
    const staleCheckIn = dayjs().subtract(14, 'day').format('YYYY-MM-DD');
    const staleCheckOut = dayjs().subtract(10, 'day').format('YYYY-MM-DD');

    const karlSmithRecentOne = await seedReservation(ctx.knex, {
      ...recentStay,
      firstName: 'Karl',
      lastName: 'Smith',
    });
    const karlSmithRecentTwo = await seedReservation(ctx.knex, {
      checkIn: dayjs().add(5, 'day').format('YYYY-MM-DD'),
      checkOut: dayjs().add(7, 'day').format('YYYY-MM-DD'),
      firstName: 'Karl',
      lastName: 'Smith',
    });
    const karlSmithStale = await seedReservation(ctx.knex, {
      checkIn: staleCheckIn,
      checkOut: staleCheckOut,
      firstName: 'Karl',
      lastName: 'Smith',
    });
    const carlSmithOne = await seedReservation(ctx.knex, {
      ...recentStay,
      firstName: 'Carl',
      lastName: 'Smith',
    });
    const carlSmithTwo = await seedReservation(ctx.knex, {
      checkIn: dayjs().add(8, 'day').format('YYYY-MM-DD'),
      checkOut: dayjs().add(10, 'day').format('YYYY-MM-DD'),
      firstName: 'Carl',
      lastName: 'Smith',
    });
    const karlSmythRecent = await seedReservation(ctx.knex, {
      ...recentStay,
      firstName: 'Karl',
      lastName: 'Smyth',
    });
    const karlSmythStale = await seedReservation(ctx.knex, {
      checkIn: staleCheckIn,
      checkOut: staleCheckOut,
      firstName: 'Karl',
      lastName: 'Smyth',
    });
    const carlSmythOne = await seedReservation(ctx.knex, {
      ...recentStay,
      firstName: 'Carl',
      lastName: 'Smyth',
    });
    const carlSmythTwo = await seedReservation(ctx.knex, {
      ...recentStay,
      firstName: 'Carl',
      lastName: 'Smyth',
    });

    const results = await searchReservationByGuestName({
      hotelId: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      name: 'Karl Smith',
    });

    expect(results.map((reservation) => reservation.booking_id).sort()).toEqual(
      [
        karlSmithRecentOne.bookingId,
        karlSmithRecentTwo.bookingId,
        carlSmithOne.bookingId,
        carlSmithTwo.bookingId,
        karlSmythRecent.bookingId,
        carlSmythOne.bookingId,
        carlSmythTwo.bookingId,
      ].sort(),
    );
    expect(results.map((reservation) => reservation.booking_id)).not.toContain(
      karlSmithStale.bookingId,
    );
    expect(results.map((reservation) => reservation.booking_id)).not.toContain(
      karlSmythStale.bookingId,
    );
  });

  it('restricts search results to the requested hotel', async () => {
    const { checkIn, checkOut } = defaultStayDates();

    await seedOtherHotel(ctx.knex);

    const requestedHotelMatch = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Mike',
      lastName: 'Smith',
    });
    await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Mike',
      lastName: 'Smith',
      hotelId: OTHER_HOTEL_ID,
    });

    const results = await searchReservationByGuestName({
      hotelId: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      name: 'Mike Smith',
    });

    expect(results).toHaveLength(1);
    expect(results[0].booking_id).toBe(requestedHotelMatch.bookingId);
  });

  it('returns multiple reservations for the same guest name', async () => {
    const firstStay = defaultStayDates();
    const secondStay = {
      checkIn: dayjs().add(10, 'day').format('YYYY-MM-DD'),
      checkOut: dayjs().add(12, 'day').format('YYYY-MM-DD'),
    };

    const firstBooking = await seedReservation(ctx.knex, {
      ...firstStay,
      firstName: 'Karl',
      lastName: 'Smith',
    });
    const secondBooking = await seedReservation(ctx.knex, {
      ...secondStay,
      customerId: firstBooking.customerId,
      firstName: 'Karl',
      lastName: 'Smith',
    });

    const results = await searchReservationByGuestName({
      hotelId: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      name: 'Karl Smith',
    });

    expect(results).toHaveLength(2);
    expect(results.map((reservation) => reservation.booking_id).sort()).toEqual(
      [firstBooking.bookingId, secondBooking.bookingId].sort(),
    );
  });

  describe('fuzzy match boundaries via getReservationDetails', () => {
    let service: RoomReservationService;
    let pmsGuestLookupSpy: jest.SpyInstance;
    let pmsPhoneLookupSpy: jest.SpyInstance;
    let pmsPhoneTimeoutSpy: jest.SpyInstance;

    beforeEach(async () => {
      await ctx
        .knex('hotels')
        .where({ id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
        .update({ pms_provider: PmsProvider.STAYNTOUCH });

      const stayntouchService = new StayntouchReservationService(
        RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      );
      pmsGuestLookupSpy = mockTimedOutPmsGuestLookup(stayntouchService);
      pmsPhoneLookupSpy = mockTimedOutPmsPhoneLookup(stayntouchService);

      const pmsServiceFactory = {
        getReservationService: jest.fn().mockResolvedValue(stayntouchService),
      } as unknown as PMSServiceFactory;

      ({ service } = createTestRoomReservationService({
        knex: ctx.knex,
        externalStubs: { pmsServiceFactory },
      }));
      pmsPhoneTimeoutSpy = mockTimedOutPmsPhoneLookupAtServiceLevel(service);
    });

    afterEach(() => {
      pmsGuestLookupSpy.mockRestore();
      pmsPhoneLookupSpy.mockRestore();
      pmsPhoneTimeoutSpy.mockRestore();
    });

    it.each(FUZZY_MATCH_BOUNDARY_SETS)(
      'documents fuzzy match boundaries for seeded $name',
      async ({ name, matches, nonMatches }) => {
        const { checkIn, checkOut } = defaultStayDates();
        const targetGuest = parseGuestFullName(name);

        const targetBooking = await seedReservation(ctx.knex, {
          checkIn,
          checkOut,
          firstName: targetGuest.firstName,
          lastName: targetGuest.lastName,
        });

        const nonMatchBookings = new Map<string, string>();

        for (const nonMatchName of nonMatches) {
          const guest = parseGuestFullName(nonMatchName);
          const booking = await seedReservation(ctx.knex, {
            checkIn,
            checkOut,
            firstName: guest.firstName,
            lastName: guest.lastName,
          });
          nonMatchBookings.set(nonMatchName, booking.bookingId);
        }

        for (const matchName of matches) {
          const results = await service.getReservationDetails(
            UNMATCHED_CALLER_PHONE,
            RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
            undefined,
            undefined,
            matchName,
          );

          expect(pmsGuestLookupSpy).toHaveBeenCalled();
          expect(results).toHaveLength(1);
          expect(results[0].booking_id).toBe(targetBooking.bookingId);
        }

        for (const nonMatchName of nonMatches) {
          const results = await service.getReservationDetails(
            UNMATCHED_CALLER_PHONE,
            RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
            undefined,
            undefined,
            nonMatchName,
          );

          expect(
            results.map((reservation) => reservation.booking_id),
          ).not.toContain(targetBooking.bookingId);
          expect(
            results.map((reservation) => reservation.booking_id),
          ).toContain(nonMatchBookings.get(nonMatchName));
        }
      },
    );
  });

  it('ranks surname matches above first-name-only typos for the same search', async () => {
    const { checkIn, checkOut } = defaultStayDates();

    const janeSmith = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Jane',
      lastName: 'Smith',
    });
    const jayneSmoth = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Jayne',
      lastName: 'Smoth',
    });

    const results = await searchReservationByGuestName({
      hotelId: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      name: 'Jayne Smith',
    });

    expect(results).toHaveLength(2);
    expect(results[0].booking_id).toBe(janeSmith.bookingId);
    expect(results[1].booking_id).toBe(jayneSmoth.bookingId);
  });

  it('matches reservations when the search name is a single token', async () => {
    const { checkIn, checkOut } = defaultStayDates();

    const arnoldReservation = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Arnold',
      lastName: 'Porter',
    });
    await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Jane',
      lastName: 'Foobar',
    });

    const results = await searchReservationByGuestName({
      hotelId: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      name: 'Arnold',
    });

    expect(results).toHaveLength(1);
    expect(results[0].booking_id).toBe(arnoldReservation.bookingId);
  });

  it('allows minSimilarity override to include lower-scoring name matches', async () => {
    const { checkIn, checkOut } = defaultStayDates();

    /** Included even with a more restrictive threshold (score ~1.0). */
    await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Karl',
      lastName: 'Smith',
    });
    /** Excluded with a more restrictive threshold; included at the default threshold (score ~0.4). */
    await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Carl',
      lastName: 'Smith',
    });
    /** Excluded with a more restrictive threshold; included at the default threshold (score ~0.33). */
    await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Karl',
      lastName: 'Smyth',
    });

    const defaultResults = await searchReservationByGuestName({
      hotelId: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      name: 'Karl Smith',
    });
    expect(defaultResults).toHaveLength(3);

    const permissiveResults = await searchReservationByGuestName({
      hotelId: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      minSimilarity: 0.25,
      name: 'Karl Smith',
    });
    expect(permissiveResults).toHaveLength(3);

    const restrictiveResults = await searchReservationByGuestName({
      hotelId: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      minSimilarity: 0.45,
      name: 'Karl Smith',
    });
    expect(restrictiveResults).toHaveLength(1);
  });
});

function parseGuestFullName(fullName: string): {
  firstName: string;
  lastName: string;
} {
  const [firstName, ...lastNameParts] = fullName.split(' ');
  return {
    firstName,
    lastName: lastNameParts.join(' '),
  };
}
