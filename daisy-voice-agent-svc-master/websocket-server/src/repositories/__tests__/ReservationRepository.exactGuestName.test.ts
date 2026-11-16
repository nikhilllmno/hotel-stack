import { ReservationRepository } from '@/repositories/ReservationRepository';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { seedReservation } from '@/test/fixtures/reservationSeedFixture';
import dayjs from 'dayjs';

describe('ReservationRepository.getReservationsByExactGuestName (pg-mem)', () => {
  const ctx = installPgMemTestContext();
  let repository: ReservationRepository;

  beforeEach(() => {
    repository = new ReservationRepository(ctx.knex);
  });

  async function seedGuest(firstName: string, lastName: string) {
    const checkIn = dayjs().add(1, 'day').format('YYYY-MM-DD');
    const checkOut = dayjs().add(3, 'day').format('YYYY-MM-DD');
    return seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName,
      lastName,
    });
  }

  it('matches full name case-insensitively', async () => {
    const seeded = await seedGuest('John', 'Smith');

    const results = await repository.getReservationsByExactGuestName(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      'john smith',
    );

    expect(results.map((r) => r.id)).toEqual([seeded.reservationId]);
  });

  it('matches when first and last name are given in reversed order', async () => {
    const seeded = await seedGuest('John', 'Smith');

    const results = await repository.getReservationsByExactGuestName(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      'Smith John',
    );

    expect(results.map((r) => r.id)).toEqual([seeded.reservationId]);
  });

  it('matches a single-token name against either first or last name', async () => {
    const seeded = await seedGuest('John', 'Smith');

    const byFirst = await repository.getReservationsByExactGuestName(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      'John',
    );
    const byLast = await repository.getReservationsByExactGuestName(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      'Smith',
    );

    expect(byFirst.map((r) => r.id)).toEqual([seeded.reservationId]);
    expect(byLast.map((r) => r.id)).toEqual([seeded.reservationId]);
  });

  it('restricts a single-token name to the given name part when specified', async () => {
    const seeded = await seedGuest('John', 'Smith');

    const asFirst = await repository.getReservationsByExactGuestName(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      'John',
      'first',
    );
    const asLastForFirstToken =
      await repository.getReservationsByExactGuestName(
        RESERVATION_FLOW_FIXTURE_IDS.hotelId,
        'John',
        'last',
      );
    const asLast = await repository.getReservationsByExactGuestName(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      'Smith',
      'last',
    );

    expect(asFirst.map((r) => r.id)).toEqual([seeded.reservationId]);
    expect(asLastForFirstToken).toHaveLength(0);
    expect(asLast.map((r) => r.id)).toEqual([seeded.reservationId]);
  });

  it('does not match a misspelled/approximate name (no fuzzy matching)', async () => {
    await seedGuest('John', 'Smith');

    const results = await repository.getReservationsByExactGuestName(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      'Jon Smyth',
    );

    expect(results).toHaveLength(0);
  });

  it('returns an empty array for a blank name', async () => {
    await seedGuest('John', 'Smith');

    const results = await repository.getReservationsByExactGuestName(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      '   ',
    );

    expect(results).toHaveLength(0);
  });
});
