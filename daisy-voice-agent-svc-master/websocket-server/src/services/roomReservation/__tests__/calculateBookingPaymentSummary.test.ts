import { PaymentStatus } from '@/dtos/enum/PaymentStatus';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import {
  defaultStayDates,
  seedReservation,
} from '@/test/fixtures/reservationSeedFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { randomUUID as uuidv4 } from 'node:crypto';
import { RoomReservationService } from '../roomReservationService';

/**
 * Regression coverage for the "one cent short" payment-summary bug. The two
 * production payments 994.56 + 248.64 sum to 1243.20 mathematically but land on
 * 1243.1999999999998 in IEEE-754, so calculateBookingPaymentSummary used to
 * return raw float sums (totalPaidAmount 1243.1999999999998, remainingAmount
 * 2.27e-13). Every serialized money field must now be rounded to cents.
 * Production repro: booking BK02188 at The Edgewater Hotel.
 */
describe('RoomReservationService.calculateBookingPaymentSummary (currency rounding)', () => {
  const ctx = installPgMemTestContext();
  let service: RoomReservationService;

  beforeEach(() => {
    service = createTestRoomReservationService({ knex: ctx.knex }).service;
  });

  const seedPaidBooking = async (
    amountsCharged: string[],
  ): Promise<{ bookingId: string; hotelId: string }> => {
    const { checkIn, checkOut } = defaultStayDates();
    const reservation = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Machell',
      lastName: 'Cano',
    });

    const now = new Date();
    // base_rate + taxes + fees === 1243.20 (the reservation total)
    await ctx.knex('quotes').insert({
      amount_charged: 248.64,
      base_rate: 1110,
      created_at: now,
      fees: 0,
      id: uuidv4(),
      reservation_id: reservation.reservationId,
      taxes: 133.2,
      updated_at: now,
    });

    for (const amount of amountsCharged) {
      const paymentId = uuidv4();
      await ctx.knex('payments').insert({
        amount_charged: amount,
        amount_refunded: '0.00',
        booking_confirmation_id: `ch_${paymentId.slice(0, 8)}`,
        created_at: now,
        currency: 'usd',
        hotel_id: reservation.hotelId,
        id: paymentId,
        notification_count: 0,
        payment_provider: 'stripe',
        payment_status: PaymentStatus.COMPLETED,
        updated_at: now,
      });
      await ctx.knex('payment_reservations').insert({
        created_at: now,
        id: uuidv4(),
        payment_id: paymentId,
        reservation_id: reservation.reservationId,
        updated_at: now,
      });
    }

    return { bookingId: reservation.bookingId, hotelId: reservation.hotelId };
  };

  it('rounds every money field so a fully-paid booking reports a clean zero balance', async () => {
    const { bookingId, hotelId } = await seedPaidBooking(['994.56', '248.64']);

    const summary = await service.calculateBookingPaymentSummary(
      bookingId,
      hotelId,
    );

    expect(summary.totalReservationAmount).toBe(1243.2);
    expect(summary.totalPaidAmount).toBe(1243.2);
    expect(summary.totalRefundedAmount).toBe(0);
    expect(summary.refundableAmount).toBe(1243.2);
    // Was 2.2737367544323206e-13 before rounding — the "one cent short" residue.
    expect(summary.remainingAmount).toBe(0);

    // No field may carry floating-point noise past two decimals.
    for (const value of Object.values(summary)) {
      if (typeof value === 'number') {
        expect(value).toBe(Number(value.toFixed(2)));
      }
    }
  });
});
