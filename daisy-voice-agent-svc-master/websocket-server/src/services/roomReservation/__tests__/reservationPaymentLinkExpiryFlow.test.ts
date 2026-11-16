import config from '@/config';
import { PaymentStatus } from '@/dtos/enum/PaymentStatus';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import { BadRequestError } from '@/errors/BadRequestError';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import {
  ageReservationAndPayment,
  RESERVATION_FLOW_FIXTURE_IDS,
} from '@/test/fixtures/reservationFlowFixture';
import { DEFAULT_TEST_PAYMENT_LINK_ID } from '@/test/mocks/testPaymentLinkDefaults';
import { TestPaymentServiceBundle } from '@/test/stubs/createTestPaymentService';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { StubPmsReservationService } from '@/test/stubs/StubPmsReservationService';
import { PaymentProvider } from '@/types/enums';
import dayjs from 'dayjs';
import { RoomReservationService } from '../roomReservationService';

describe('RoomReservationService reservation payment-link expiry flow', () => {
  const ctx = installPgMemTestContext();
  let service: RoomReservationService;
  let stubPmsService: StubPmsReservationService;
  let stripeService: TestPaymentServiceBundle['stripeService'];

  beforeEach(() => {
    stubPmsService = new StubPmsReservationService();
    const bundle = createTestRoomReservationService({
      externalStubs: { pmsReservationService: stubPmsService },
      knex: ctx.knex,
    });
    service = bundle.service;
    stripeService = bundle.paymentBundle.stripeService;
  });

  it('creates SMS reservation, serves payment link, then expires it after stale cutoff', async () => {
    const checkIn = dayjs().add(7, 'day').format('YYYY-MM-DD');
    const checkOut = dayjs().add(9, 'day').format('YYYY-MM-DD');
    const sessionId = '77777777-7777-7777-7777-777777777777';

    const created = await service.createSingleRoomReservation(
      {
        check_in: checkIn,
        check_out: checkOut,
        customer_first_name: 'Test',
        customer_last_name: 'Guest',
        customer_phone_number: '+15559876543',
        num_adults: 2,
        room_id: 101,
        session_type: SessionType.SMS,
      },
      '+15559876543',
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      sessionId,
      SessionType.SMS,
    );

    const payment = created.payments[0];

    expect(created.status).toBe(ReservationStatus.INACTIVE);
    expect(payment.payment_link_id).toBe(DEFAULT_TEST_PAYMENT_LINK_ID);

    const reservationRow = await ctx
      .knex('reservations')
      .where({ id: created.id })
      .first();
    const paymentRow = await ctx
      .knex('payments')
      .where({ id: payment.id })
      .first();
    const quoteRow = await ctx
      .knex('quotes')
      .where({ reservation_id: created.id })
      .first();
    const paymentReservationRow = await ctx
      .knex('payment_reservations')
      .where({
        payment_id: payment.id,
        reservation_id: created.id,
      })
      .first();

    expect(reservationRow.status).toBe(ReservationStatus.INACTIVE);
    expect(paymentRow.payment_status).toBe(PaymentStatus.PENDING);
    expect(paymentRow.payment_link).toContain(DEFAULT_TEST_PAYMENT_LINK_ID);
    expect(paymentRow.payment_link_id).toBe(DEFAULT_TEST_PAYMENT_LINK_ID);
    expect(quoteRow).toBeDefined();
    expect(paymentReservationRow).toBeDefined();

    const bookingReviewRow = await ctx
      .knex('booking_reviews')
      .where({ booking_id: created.booking_id })
      .first();
    expect(bookingReviewRow).toBeDefined();

    // SMS/CHAT response exposes the review URL, not the direct payment URL
    const expectedReviewUrl = `${config.SECURE_URL}/test_hotel/${bookingReviewRow.reservation_review_id}`;
    expect(payment.payment_link).toBe(expectedReviewUrl);

    const detailsBeforeExpiry = await service.getReservationDetailsByReviewId(
      bookingReviewRow.reservation_review_id,
    );
    expect(detailsBeforeExpiry.reservations).toHaveLength(1);
    expect(stubPmsService.validateRoomAvailability).toHaveBeenCalled();

    await ageReservationAndPayment(ctx.knex, created.id, payment.id, 120);

    const cancelResult = await service.cancelStaleReservationsAndPayments(60);

    expect(cancelResult).toEqual({
      cancelled: 1,
      errors: [],
      processed: 1,
      reservations_updated: 1,
    });
    expect(stripeService.deactivatePaymentResources).toHaveBeenCalledWith(
      DEFAULT_TEST_PAYMENT_LINK_ID,
      undefined,
    );

    const updatedReservation = await ctx
      .knex('reservations')
      .where({ id: created.id })
      .first();
    const updatedPayment = await ctx
      .knex('payments')
      .where({ id: payment.id })
      .first();

    expect(updatedReservation.status).toBe(ReservationStatus.CANCELLED);
    expect(updatedReservation.previous_status).toBe(ReservationStatus.INACTIVE);
    expect(updatedPayment.payment_status).toBe(PaymentStatus.CANCELLED);
    expect(updatedPayment.payment_link_disabled).toBe(true);

    await expect(
      service.getReservationDetailsByReviewId(
        bookingReviewRow.reservation_review_id,
      ),
    ).rejects.toThrow(new BadRequestError('This payment link has expired'));
  });
  // Mews, Opera and Authorize.Net all mint a review page URL as their
  // "payment link". There is nothing hosted at the provider, so expiring one
  // must never reach Stripe, which would be handed a link id it never issued.
  it.each([
    PaymentProvider.MEWS,
    PaymentProvider.OPERA,
    PaymentProvider.AUTHORIZE_NET,
  ])(
    'expires a %s review page link without calling Stripe',
    async (provider) => {
      const checkIn = dayjs().add(7, 'day').format('YYYY-MM-DD');
      const checkOut = dayjs().add(9, 'day').format('YYYY-MM-DD');

      const created = await service.createSingleRoomReservation(
        {
          check_in: checkIn,
          check_out: checkOut,
          customer_first_name: 'Test',
          customer_last_name: 'Guest',
          customer_phone_number: '+15559876543',
          num_adults: 2,
          room_id: 101,
          session_type: SessionType.SMS,
        },
        '+15559876543',
        RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
        '77777777-7777-7777-7777-777777777777',
        SessionType.SMS,
      );
      const payment = created.payments[0];

      // The disable path keys off the payment row, not the hotel, so this is the
      // state a hotel on that provider produces.
      await ctx
        .knex('payments')
        .where({ id: payment.id })
        .update({ payment_provider: provider });

      await ageReservationAndPayment(ctx.knex, created.id, payment.id, 120);

      const cancelResult = await service.cancelStaleReservationsAndPayments(60);

      expect(cancelResult.errors).toEqual([]);
      expect(stripeService.deactivatePaymentResources).not.toHaveBeenCalled();

      const updatedPayment = await ctx
        .knex('payments')
        .where({ id: payment.id })
        .first();
      expect(updatedPayment.payment_link_disabled).toBe(true);
      expect(updatedPayment.payment_status).toBe(PaymentStatus.CANCELLED);

      const bookingReviewRow = await ctx
        .knex('booking_reviews')
        .where({ booking_id: created.booking_id })
        .first();
      await expect(
        service.getReservationDetailsByReviewId(
          bookingReviewRow.reservation_review_id,
        ),
      ).rejects.toThrow(new BadRequestError('This payment link has expired'));
    },
  );
});
