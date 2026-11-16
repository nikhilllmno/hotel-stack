import { ReservationRepository } from '@/repositories/ReservationRepository';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { seedReservation } from '@/test/fixtures/reservationSeedFixture';
import dayjs from 'dayjs';

const TEST_CALLER_PHONE = '+14083205093';

describe('ReservationRepository test phone lookups (pg-mem)', () => {
  const ctx = installPgMemTestContext();
  let repository: ReservationRepository;

  beforeEach(() => {
    repository = new ReservationRepository(ctx.knex);
  });

  async function seedReservationWithPhone(checkInOffsetDays: number) {
    const checkIn = dayjs().add(checkInOffsetDays, 'day').format('YYYY-MM-DD');
    const checkOut = dayjs()
      .add(checkInOffsetDays + 2, 'day')
      .format('YYYY-MM-DD');
    const seeded = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Test',
      lastName: 'Guest',
    });

    await ctx
      .knex('customers')
      .where({ id: seeded.customerId })
      .update({ phone_number: TEST_CALLER_PHONE });
    await ctx
      .knex('reservations')
      .where({ id: seeded.reservationId })
      .update({ phone_number: TEST_CALLER_PHONE });

    return seeded;
  }

  it('getTestReservationsByPhoneNumber returns at most two newest reservations', async () => {
    await seedReservationWithPhone(1);
    await seedReservationWithPhone(5);
    const third = await seedReservationWithPhone(10);
    const fourth = await seedReservationWithPhone(15);

    const results = await repository.getTestReservationsByPhoneNumber(
      TEST_CALLER_PHONE,
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
    );

    expect(results).toHaveLength(2);
    expect(results.map((reservation) => reservation.id)).toEqual([
      fourth.reservationId,
      third.reservationId,
    ]);
  });

  it('getTestReservationsByLastDigitsPhoneNumber returns at most two newest reservations', async () => {
    await seedReservationWithPhone(1);
    await seedReservationWithPhone(5);
    const third = await seedReservationWithPhone(10);
    const fourth = await seedReservationWithPhone(15);

    const results = await repository.getTestReservationsByLastDigitsPhoneNumber(
      '3205093',
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
    );

    expect(results).toHaveLength(2);
    expect(results.map((reservation) => reservation.id)).toEqual([
      fourth.reservationId,
      third.reservationId,
    ]);
  });
});
