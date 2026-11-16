import { PaymentStatus } from '@/dtos/enum/PaymentStatus';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { installPgMemTestContextWithoutHotel } from '@/test/db/createPgMemTestContext';
import { seedStaleReservationWithPayment } from '@/test/fixtures/staleReservationFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { RoomReservationService } from '../roomReservationService';

describe('RoomReservationService.cancelStaleReservationsAndPayments', () => {
  const ctx = installPgMemTestContextWithoutHotel();
  let service: RoomReservationService;

  beforeEach(() => {
    ({ service } = createTestRoomReservationService({ knex: ctx.knex }));
  });

  it('cancels stale inactive reservations and their pending payments', async () => {
    const fixture = await seedStaleReservationWithPayment(ctx.knex, {
      ageMinutes: 120,
    });

    const result = await service.cancelStaleReservationsAndPayments(60);

    expect(result).toEqual({
      cancelled: 1,
      errors: [],
      processed: 1,
      reservations_updated: 1,
    });

    const updatedReservation = await ctx
      .knex('reservations')
      .where({ id: fixture.reservationId })
      .first();
    const updatedPayment = await ctx
      .knex('payments')
      .where({ id: fixture.paymentId })
      .first();

    expect(updatedReservation.status).toBe(ReservationStatus.CANCELLED);
    expect(updatedReservation.previous_status).toBe(ReservationStatus.INACTIVE);
    expect(updatedPayment.payment_status).toBe(PaymentStatus.CANCELLED);
  });
});
