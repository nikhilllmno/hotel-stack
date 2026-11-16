import { NoDataError } from '@/errors/NoDataError';
import { installPostgresIntegrationTestContext } from '@/test/db/createPostgresIntegrationTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import {
  defaultStayDates,
  OTHER_HOTEL_ID,
  SeededReservation,
  seedOtherHotel,
  seedReservation,
} from '@/test/fixtures/reservationSeedFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { RoomReservationService } from '../roomReservationService';

const DEFAULT_SEEDED_PHONE = '+15550001111';
const UNMATCHED_CALLER_PHONE = '+15559876543';
const ASSISTANT_PHONE = RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber;
const LAST_DIGITS = '1111';
const WRONG_LAST_DIGITS = '9999';
const WRONG_BOOKING_ID = 'UNKNOWN-CONF-123';
const WRONG_GUEST_NAME = 'Nobody Here';
const GUEST_NAME = 'Pter Parker';

type GetReservationDetailsArgs = [
  callerPhoneNumber: string,
  assistantPhoneNumber: string,
  bookingId?: string,
  lastDigitsPhoneNumber?: string,
  guestName?: string,
];

interface SuccessCase {
  description: string;
  buildParams: (seeded: SeededReservation) => GetReservationDetailsArgs;
}

interface FailureCase {
  description: string;
  buildParams: (seeded: SeededReservation) => GetReservationDetailsArgs;
  expectedMessage: string;
}

const SUCCESS_CASES: SuccessCase[] = [
  {
    description: 'bookingId lookup with matching caller phone',
    buildParams: (seeded) => [
      DEFAULT_SEEDED_PHONE,
      ASSISTANT_PHONE,
      seeded.bookingId,
    ],
  },
  {
    description: 'bookingId lookup with non-matching caller phone',
    buildParams: (seeded) => [
      UNMATCHED_CALLER_PHONE,
      ASSISTANT_PHONE,
      seeded.bookingId,
    ],
  },
  {
    description:
      'bookingId lookup rescued by caller-phone supplement when booking id is wrong',
    buildParams: () => [
      DEFAULT_SEEDED_PHONE,
      ASSISTANT_PHONE,
      WRONG_BOOKING_ID,
    ],
  },
  {
    description: 'lastDigits lookup with matching caller phone',
    buildParams: () => [
      DEFAULT_SEEDED_PHONE,
      ASSISTANT_PHONE,
      undefined,
      LAST_DIGITS,
    ],
  },
  {
    description: 'lastDigits lookup with non-matching caller phone',
    buildParams: () => [
      UNMATCHED_CALLER_PHONE,
      ASSISTANT_PHONE,
      undefined,
      LAST_DIGITS,
    ],
  },
  {
    description:
      'lastDigits lookup rescued by caller-phone supplement when last digits are wrong',
    buildParams: () => [
      DEFAULT_SEEDED_PHONE,
      ASSISTANT_PHONE,
      undefined,
      WRONG_LAST_DIGITS,
    ],
  },
  {
    description: 'guestName lookup with matching caller phone',
    buildParams: () => [
      DEFAULT_SEEDED_PHONE,
      ASSISTANT_PHONE,
      undefined,
      undefined,
      GUEST_NAME,
    ],
  },
  {
    description: 'guestName lookup with non-matching caller phone',
    buildParams: () => [
      UNMATCHED_CALLER_PHONE,
      ASSISTANT_PHONE,
      undefined,
      undefined,
      GUEST_NAME,
    ],
  },
  {
    description:
      'guestName lookup rescued by caller-phone supplement when guest name is wrong',
    buildParams: () => [
      DEFAULT_SEEDED_PHONE,
      ASSISTANT_PHONE,
      undefined,
      undefined,
      WRONG_GUEST_NAME,
    ],
  },
];

const FAILURE_CASES: FailureCase[] = [
  {
    description: 'returns no reservation when no lookup details match',
    buildParams: () => [
      UNMATCHED_CALLER_PHONE,
      ASSISTANT_PHONE,
      WRONG_BOOKING_ID,
      WRONG_LAST_DIGITS,
      WRONG_GUEST_NAME,
    ],
    expectedMessage: `getReservationDetails: No reservation found for booking ID ${WRONG_BOOKING_ID}`,
  },
];

describe('RoomReservationService getReservationDetails lookup methods integration (postgres)', () => {
  const ctx = installPostgresIntegrationTestContext();
  let service: RoomReservationService;
  let seeded: SeededReservation;

  beforeEach(async () => {
    ({ service } = createTestRoomReservationService({ knex: ctx.knex }));

    const { checkIn, checkOut } = defaultStayDates();
    seeded = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Peter',
      lastName: 'Parker',
    });

    await seedOtherHotel(ctx.knex);
    await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Peter',
      lastName: 'Parker',
      hotelId: OTHER_HOTEL_ID,
    });
  });

  for (const successCase of SUCCESS_CASES) {
    it(successCase.description, async () => {
      const results = await service.getReservationDetails(
        ...successCase.buildParams(seeded),
      );

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(seeded.reservationId);
      expect(results[0].booking_id).toBe(seeded.bookingId);
    });
  }

  for (const failureCase of FAILURE_CASES) {
    it(failureCase.description, async () => {
      await expect(
        service.getReservationDetails(...failureCase.buildParams(seeded)),
      ).rejects.toThrow(NoDataError);

      await expect(
        service.getReservationDetails(...failureCase.buildParams(seeded)),
      ).rejects.toThrow(failureCase.expectedMessage);
    });
  }
});
