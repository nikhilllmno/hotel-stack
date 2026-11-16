import config from '@/config';
import { ReservationPaymentStatus } from '@/dtos/enum/ReservationPaymentStatus';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { StubPmsReservationService } from '@/test/stubs/StubPmsReservationService';
import { PaymentProvider } from '@/types/enums';
import dayjs from 'dayjs';
import { RoomReservationService } from '../roomReservationService';

const NO_PAYMENT_HOTEL_PHONE = '+15559990000';

async function seedNoPaymentHotel(knex: import('knex').Knex) {
  const now = new Date();
  await knex('hotels')
    .where({ id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
    .update({
      payment_provider: PaymentProvider.NOT_APPLICABLE,
      assistant_phone_number: NO_PAYMENT_HOTEL_PHONE,
      updated_at: now,
    });
}

describe('No-payment reservation flow', () => {
  const ctx = installPgMemTestContext();
  let service: RoomReservationService;
  let stubPmsService: StubPmsReservationService;

  beforeEach(async () => {
    await seedNoPaymentHotel(ctx.knex);
    stubPmsService = new StubPmsReservationService();
    ({ service } = createTestRoomReservationService({
      externalStubs: { pmsReservationService: stubPmsService },
      knex: ctx.knex,
    }));
  });

  const checkIn = () => dayjs().add(7, 'day').format('YYYY-MM-DD');
  const checkOut = () => dayjs().add(9, 'day').format('YYYY-MM-DD');
  const sessionId = '77777777-7777-7777-7777-777777777777';

  describe('createSingleRoomReservation', () => {
    it('creates reservation with NOT_APPLICABLE payment status and no payments', async () => {
      const created = await service.createSingleRoomReservation(
        {
          check_in: checkIn(),
          check_out: checkOut(),
          customer_first_name: 'Test',
          customer_last_name: 'Guest',
          customer_phone_number: '+15559876543',
          num_adults: 2,
          room_id: 101,
          session_type: SessionType.SMS,
        },
        '+15559876543',
        NO_PAYMENT_HOTEL_PHONE,
        sessionId,
        SessionType.SMS,
      );

      expect(created.status).toBe(ReservationStatus.INACTIVE);
      expect(created.payment_status).toBe(
        ReservationPaymentStatus.NOT_APPLICABLE,
      );
      expect(created.payments).toEqual([]);
      expect((created as any).payment_link).toContain(config.SECURE_URL);

      const reservationRow = await ctx
        .knex('reservations')
        .where({ id: created.id })
        .first();
      expect(reservationRow.status).toBe(ReservationStatus.INACTIVE);
      expect(reservationRow.payment_status).toBe(
        ReservationPaymentStatus.NOT_APPLICABLE,
      );

      const paymentRows = await ctx
        .knex('payments')
        .where({ hotel_id: RESERVATION_FLOW_FIXTURE_IDS.hotelId });
      expect(paymentRows).toHaveLength(0);

      const bookingReviewRow = await ctx
        .knex('booking_reviews')
        .where({ booking_id: created.booking_id })
        .first();
      expect(bookingReviewRow).toBeDefined();
      expect(bookingReviewRow.reservation_review_id).toBeDefined();
    });

    it('returns a review URL containing the reservation_review_id', async () => {
      const created = await service.createSingleRoomReservation(
        {
          check_in: checkIn(),
          check_out: checkOut(),
          customer_first_name: 'Test',
          customer_last_name: 'Guest',
          customer_phone_number: '+15559876543',
          num_adults: 2,
          room_id: 101,
          session_type: SessionType.SMS,
        },
        '+15559876543',
        NO_PAYMENT_HOTEL_PHONE,
        sessionId,
        SessionType.SMS,
      );

      const bookingReviewRow = await ctx
        .knex('booking_reviews')
        .where({ booking_id: created.booking_id })
        .first();

      expect((created as any).payment_link).toContain(
        bookingReviewRow.reservation_review_id,
      );
    });
  });

  describe('stale reservation cleanup', () => {
    it('cancelStaleReservationsAndPayments excludes NOT_APPLICABLE reservations', async () => {
      const created = await service.createSingleRoomReservation(
        {
          check_in: checkIn(),
          check_out: checkOut(),
          customer_first_name: 'Test',
          customer_last_name: 'Guest',
          customer_phone_number: '+15559876543',
          num_adults: 2,
          room_id: 101,
          session_type: SessionType.SMS,
        },
        '+15559876543',
        NO_PAYMENT_HOTEL_PHONE,
        sessionId,
        SessionType.SMS,
      );

      // Age the reservation past the stale cutoff
      const staleCreatedAt = new Date(Date.now() - 120 * 60 * 1000);
      await ctx
        .knex('reservations')
        .where({ id: created.id })
        .update({ created_at: staleCreatedAt, updated_at: staleCreatedAt });

      const result = await service.cancelStaleReservationsAndPayments(60);

      expect(result.cancelled).toBe(0);
      expect(result.processed).toBe(0);

      const reservationRow = await ctx
        .knex('reservations')
        .where({ id: created.id })
        .first();
      expect(reservationRow.status).toBe(ReservationStatus.INACTIVE);
    });

    it('cancelStaleNoPaymentReservations cancels stale NOT_APPLICABLE reservations', async () => {
      const created = await service.createSingleRoomReservation(
        {
          check_in: checkIn(),
          check_out: checkOut(),
          customer_first_name: 'Test',
          customer_last_name: 'Guest',
          customer_phone_number: '+15559876543',
          num_adults: 2,
          room_id: 101,
          session_type: SessionType.SMS,
        },
        '+15559876543',
        NO_PAYMENT_HOTEL_PHONE,
        sessionId,
        SessionType.SMS,
      );

      // Age the reservation past the review timeout
      const staleCreatedAt = new Date(Date.now() - 120 * 60 * 1000);
      await ctx
        .knex('reservations')
        .where({ id: created.id })
        .update({ created_at: staleCreatedAt, updated_at: staleCreatedAt });

      const result = await service.cancelStaleNoPaymentReservations(60);

      expect(result.reservations_cancelled).toBe(1);
      expect(result.errors).toEqual([]);

      const reservationRow = await ctx
        .knex('reservations')
        .where({ id: created.id })
        .first();
      expect(reservationRow.status).toBe(ReservationStatus.CANCELLED);
    });

    it('cancelStaleNoPaymentReservations does not cancel fresh reservations', async () => {
      await service.createSingleRoomReservation(
        {
          check_in: checkIn(),
          check_out: checkOut(),
          customer_first_name: 'Test',
          customer_last_name: 'Guest',
          customer_phone_number: '+15559876543',
          num_adults: 2,
          room_id: 101,
          session_type: SessionType.SMS,
        },
        '+15559876543',
        NO_PAYMENT_HOTEL_PHONE,
        sessionId,
        SessionType.SMS,
      );

      const result = await service.cancelStaleNoPaymentReservations(60);

      expect(result.reservations_cancelled).toBe(0);
    });
  });

  describe('payment operation guards', () => {
    it('markPaymentCollectedOffline rejects for NOT_APPLICABLE reservations', async () => {
      const created = await service.createSingleRoomReservation(
        {
          check_in: checkIn(),
          check_out: checkOut(),
          customer_first_name: 'Test',
          customer_last_name: 'Guest',
          customer_phone_number: '+15559876543',
          num_adults: 2,
          room_id: 101,
          session_type: SessionType.SMS,
        },
        '+15559876543',
        NO_PAYMENT_HOTEL_PHONE,
        sessionId,
        SessionType.SMS,
      );

      await expect(
        service.markPaymentCollectedOffline(
          created.booking_id,
          RESERVATION_FLOW_FIXTURE_IDS.hotelId,
          { amount: 100, payment_method: 'cash', notes: 'test' } as any,
        ),
      ).rejects.toThrow(/does not require payment/);
    });

    it('chargeReservationImmediately rejects for NOT_APPLICABLE reservations', async () => {
      const created = await service.createSingleRoomReservation(
        {
          check_in: checkIn(),
          check_out: checkOut(),
          customer_first_name: 'Test',
          customer_last_name: 'Guest',
          customer_phone_number: '+15559876543',
          num_adults: 2,
          room_id: 101,
          session_type: SessionType.SMS,
        },
        '+15559876543',
        NO_PAYMENT_HOTEL_PHONE,
        sessionId,
        SessionType.SMS,
      );

      await expect(
        service.chargeReservationImmediately(
          created.booking_id,
          RESERVATION_FLOW_FIXTURE_IDS.hotelId,
          { amount: 100 } as any,
        ),
      ).rejects.toThrow(/does not require payment/);
    });

    it('setupAutoCharge rejects for NOT_APPLICABLE hotels', async () => {
      await expect(
        service.setupAutoCharge(
          'BKTEST001',
          RESERVATION_FLOW_FIXTURE_IDS.hotelId,
          { is_enabled: true } as any,
        ),
      ).rejects.toThrow(/does not require payment/);
    });

    it('calculateBookingPaymentSummary rejects for NOT_APPLICABLE reservations', async () => {
      const created = await service.createSingleRoomReservation(
        {
          check_in: checkIn(),
          check_out: checkOut(),
          customer_first_name: 'Test',
          customer_last_name: 'Guest',
          customer_phone_number: '+15559876543',
          num_adults: 2,
          room_id: 101,
          session_type: SessionType.SMS,
        },
        '+15559876543',
        NO_PAYMENT_HOTEL_PHONE,
        sessionId,
        SessionType.SMS,
      );

      await expect(
        service.calculateBookingPaymentSummary(
          created.booking_id,
          RESERVATION_FLOW_FIXTURE_IDS.hotelId,
        ),
      ).rejects.toThrow(/does not require payment/);
    });

    it('processBookingRefund rejects for NOT_APPLICABLE reservations', async () => {
      const created = await service.createSingleRoomReservation(
        {
          check_in: checkIn(),
          check_out: checkOut(),
          customer_first_name: 'Test',
          customer_last_name: 'Guest',
          customer_phone_number: '+15559876543',
          num_adults: 2,
          room_id: 101,
          session_type: SessionType.SMS,
        },
        '+15559876543',
        NO_PAYMENT_HOTEL_PHONE,
        sessionId,
        SessionType.SMS,
      );

      await expect(
        service.processBookingRefund(
          created.booking_id,
          RESERVATION_FLOW_FIXTURE_IDS.hotelId,
          { refundAmount: 50, reason: 'test', initiatedBy: 'admin' } as any,
        ),
      ).rejects.toThrow(/does not require payment/);
    });
  });

  describe('review page', () => {
    it('getReservationDetailsByReviewId returns null payment for no-payment reservations', async () => {
      const created = await service.createSingleRoomReservation(
        {
          check_in: checkIn(),
          check_out: checkOut(),
          customer_first_name: 'Test',
          customer_last_name: 'Guest',
          customer_phone_number: '+15559876543',
          num_adults: 2,
          room_id: 101,
          session_type: SessionType.SMS,
        },
        '+15559876543',
        NO_PAYMENT_HOTEL_PHONE,
        sessionId,
        SessionType.SMS,
      );

      const bookingReviewRow = await ctx
        .knex('booking_reviews')
        .where({ booking_id: created.booking_id })
        .first();

      const details = await service.getReservationDetailsByReviewId(
        bookingReviewRow.reservation_review_id,
      );

      expect(details.payment).toBeNull();
      expect(details.hotel?.payment_provider).toBe(
        PaymentProvider.NOT_APPLICABLE,
      );
      expect(details.reservations).toHaveLength(1);
    });
  });
});
