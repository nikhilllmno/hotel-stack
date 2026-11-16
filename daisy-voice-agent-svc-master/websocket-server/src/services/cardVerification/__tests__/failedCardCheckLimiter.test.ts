import { __for_testing } from '../failedCardCheckLimiter';

const {
  FAILED_CARD_CHECK_WINDOW_MS,
  FailedCardCheckLimiter,
  MAX_FAILED_ATTEMPTS_PER_RESERVATION,
  MAX_FAILED_RESERVATIONS_PER_PHONE,
} = __for_testing;

const HOTEL = 'hotel-1';
const PHONE = '+15559876543';
const HOUR_MS = 60 * 60 * 1000;

describe('FailedCardCheckLimiter', () => {
  let limiter: InstanceType<typeof FailedCardCheckLimiter>;

  beforeEach(() => {
    jest.useFakeTimers();
    limiter = new FailedCardCheckLimiter();
  });

  afterEach(() => jest.useRealTimers());

  function decline(reviewId: string, phoneNumber = PHONE, hotelId = HOTEL) {
    limiter.recordDecline({ hotelId, phoneNumber, reviewId });
  }

  function declineBookings(count: number, phoneNumber = PHONE, prefix = 'r') {
    for (let i = 0; i < count; i++) decline(`${prefix}-${i}`, phoneNumber);
  }

  function submission(reviewId: string, phoneNumber = PHONE) {
    return { hotelId: HOTEL, phoneNumber, reviewId };
  }

  describe('isPhoneBlocked', () => {
    it('does not block a number with no declines', () => {
      expect(limiter.isPhoneBlocked(HOTEL, PHONE)).toBe(false);
    });

    it('blocks a number once it has declines on the maximum number of bookings', () => {
      declineBookings(MAX_FAILED_RESERVATIONS_PER_PHONE - 1);
      expect(limiter.isPhoneBlocked(HOTEL, PHONE)).toBe(false);

      decline('last');
      expect(limiter.isPhoneBlocked(HOTEL, PHONE)).toBe(true);
    });

    it('stays blocked past the limit', () => {
      declineBookings(MAX_FAILED_RESERVATIONS_PER_PHONE + 5);
      expect(limiter.isPhoneBlocked(HOTEL, PHONE)).toBe(true);
    });

    it('counts many declines on one booking as one', () => {
      for (let i = 0; i < MAX_FAILED_RESERVATIONS_PER_PHONE * 2; i++) {
        decline('same-booking');
      }
      expect(limiter.isPhoneBlocked(HOTEL, PHONE)).toBe(false);
    });

    it('counts retries spread over several bookings once per booking', () => {
      for (let round = 0; round < 3; round++) {
        declineBookings(MAX_FAILED_RESERVATIONS_PER_PHONE - 1);
      }
      expect(limiter.isPhoneBlocked(HOTEL, PHONE)).toBe(false);
    });

    it.each([
      '+1 (555) 987-6543',
      '15559876543',
      '+1-555-987-6543',
      '1.555.987.6543',
    ])('treats %s as the same number', (formatted) => {
      declineBookings(MAX_FAILED_RESERVATIONS_PER_PHONE, formatted);
      expect(limiter.isPhoneBlocked(HOTEL, PHONE)).toBe(true);
    });

    it('keeps different numbers apart', () => {
      declineBookings(MAX_FAILED_RESERVATIONS_PER_PHONE);
      expect(limiter.isPhoneBlocked(HOTEL, '+15550000000')).toBe(false);
    });

    it('keeps hotels apart', () => {
      declineBookings(MAX_FAILED_RESERVATIONS_PER_PHONE);
      expect(limiter.isPhoneBlocked('hotel-2', PHONE)).toBe(false);
    });

    it('adds up declines for one number only within its hotel', () => {
      declineBookings(MAX_FAILED_RESERVATIONS_PER_PHONE - 1);
      decline('other-hotel', PHONE, 'hotel-2');
      expect(limiter.isPhoneBlocked(HOTEL, PHONE)).toBe(false);
      expect(limiter.isPhoneBlocked('hotel-2', PHONE)).toBe(false);
    });

    it('unblocks exactly 24 hours after the declines', () => {
      declineBookings(MAX_FAILED_RESERVATIONS_PER_PHONE);

      jest.advanceTimersByTime(FAILED_CARD_CHECK_WINDOW_MS - 1);
      expect(limiter.isPhoneBlocked(HOTEL, PHONE)).toBe(true);

      jest.advanceTimersByTime(1);
      expect(limiter.isPhoneBlocked(HOTEL, PHONE)).toBe(false);
    });

    it('lets old declines expire one by one', () => {
      declineBookings(MAX_FAILED_RESERVATIONS_PER_PHONE / 2, PHONE, 'early');
      jest.advanceTimersByTime(12 * HOUR_MS);
      declineBookings(MAX_FAILED_RESERVATIONS_PER_PHONE / 2, PHONE, 'late');
      expect(limiter.isPhoneBlocked(HOTEL, PHONE)).toBe(true);

      jest.advanceTimersByTime(12 * HOUR_MS);
      expect(limiter.isPhoneBlocked(HOTEL, PHONE)).toBe(false);

      declineBookings(MAX_FAILED_RESERVATIONS_PER_PHONE / 2, PHONE, 'again');
      expect(limiter.isPhoneBlocked(HOTEL, PHONE)).toBe(true);
    });

    it('restarts the 24 hours for a booking that is declined again', () => {
      declineBookings(MAX_FAILED_RESERVATIONS_PER_PHONE);
      jest.advanceTimersByTime(20 * HOUR_MS);
      declineBookings(MAX_FAILED_RESERVATIONS_PER_PHONE);

      jest.advanceTimersByTime(10 * HOUR_MS);
      expect(limiter.isPhoneBlocked(HOTEL, PHONE)).toBe(true);
    });

    it('does not count the attempts limit of one booking', () => {
      for (let i = 0; i < MAX_FAILED_ATTEMPTS_PER_RESERVATION; i++) {
        decline('one-booking');
      }
      expect(limiter.isPhoneBlocked(HOTEL, PHONE)).toBe(false);
    });
  });

  describe('isCardSubmissionBlocked', () => {
    it('does not block a booking with no declines', () => {
      expect(limiter.isCardSubmissionBlocked(submission('r-1'))).toBe(false);
    });

    it('blocks a booking once it reaches the attempts limit', () => {
      for (let i = 0; i < MAX_FAILED_ATTEMPTS_PER_RESERVATION - 1; i++) {
        decline('r-1');
      }
      expect(limiter.isCardSubmissionBlocked(submission('r-1'))).toBe(false);

      decline('r-1');
      expect(limiter.isCardSubmissionBlocked(submission('r-1'))).toBe(true);
    });

    it('only blocks the booking that hit the attempts limit', () => {
      for (let i = 0; i < MAX_FAILED_ATTEMPTS_PER_RESERVATION; i++) {
        decline('r-1');
      }
      expect(limiter.isCardSubmissionBlocked(submission('r-2'))).toBe(false);
    });

    it('blocks a new booking from a number that is blocked', () => {
      declineBookings(MAX_FAILED_RESERVATIONS_PER_PHONE);
      expect(limiter.isCardSubmissionBlocked(submission('brand-new'))).toBe(
        true,
      );
    });

    it('does not block a booking from another number', () => {
      declineBookings(MAX_FAILED_RESERVATIONS_PER_PHONE);
      expect(
        limiter.isCardSubmissionBlocked(
          submission('brand-new', '+15550000000'),
        ),
      ).toBe(false);
    });

    it('unblocks a booking 24 hours after its attempts', () => {
      for (let i = 0; i < MAX_FAILED_ATTEMPTS_PER_RESERVATION; i++) {
        decline('r-1');
      }

      jest.advanceTimersByTime(FAILED_CARD_CHECK_WINDOW_MS - 1);
      expect(limiter.isCardSubmissionBlocked(submission('r-1'))).toBe(true);

      jest.advanceTimersByTime(1);
      expect(limiter.isCardSubmissionBlocked(submission('r-1'))).toBe(false);
    });

    it('lets attempts on one booking expire one by one', () => {
      for (let i = 0; i < MAX_FAILED_ATTEMPTS_PER_RESERVATION - 1; i++) {
        decline('r-1');
      }
      jest.advanceTimersByTime(12 * HOUR_MS);
      decline('r-1');
      expect(limiter.isCardSubmissionBlocked(submission('r-1'))).toBe(true);

      jest.advanceTimersByTime(12 * HOUR_MS);
      expect(limiter.isCardSubmissionBlocked(submission('r-1'))).toBe(false);

      for (let i = 0; i < MAX_FAILED_ATTEMPTS_PER_RESERVATION - 2; i++) {
        decline('r-1');
      }
      expect(limiter.isCardSubmissionBlocked(submission('r-1'))).toBe(false);

      decline('r-1');
      expect(limiter.isCardSubmissionBlocked(submission('r-1'))).toBe(true);
    });
  });

  describe('reset', () => {
    it('forgets every decline', () => {
      declineBookings(MAX_FAILED_RESERVATIONS_PER_PHONE);
      for (let i = 0; i < MAX_FAILED_ATTEMPTS_PER_RESERVATION; i++) {
        decline('r-0');
      }

      limiter.reset();

      expect(limiter.isPhoneBlocked(HOTEL, PHONE)).toBe(false);
      expect(limiter.isCardSubmissionBlocked(submission('r-0'))).toBe(false);
    });
  });
});
