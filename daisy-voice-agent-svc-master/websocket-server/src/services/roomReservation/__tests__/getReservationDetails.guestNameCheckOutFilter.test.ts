import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { seedReservation } from '@/test/fixtures/reservationSeedFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import dayjs from 'dayjs';
import { RoomReservationService } from '../roomReservationService';

const UNMATCHED_CALLER_PHONE = '+15559876543';

describe('RoomReservationService.getReservationDetails guest_name + check_out_date filter', () => {
  const ctx = installPgMemTestContext();
  let service: RoomReservationService;

  beforeEach(() => {
    ({ service } = createTestRoomReservationService({ knex: ctx.knex }));
  });

  async function seedSameNameDifferentCheckouts() {
    const checkIn = dayjs().add(1, 'day').format('YYYY-MM-DD');
    const earlierCheckout = dayjs().add(3, 'day').format('YYYY-MM-DD');
    const laterCheckout = dayjs().add(5, 'day').format('YYYY-MM-DD');

    const earlier = await seedReservation(ctx.knex, {
      checkIn,
      checkOut: earlierCheckout,
      firstName: 'John',
      lastName: 'Smith',
    });
    const later = await seedReservation(ctx.knex, {
      checkIn,
      checkOut: laterCheckout,
      firstName: 'John',
      lastName: 'Smith',
    });

    return { earlier, earlierCheckout, later, laterCheckout };
  }

  it('returns every name match when no check_out_date is given', async () => {
    const { earlier, later } = await seedSameNameDifferentCheckouts();

    const results = await service.getReservationDetails(
      UNMATCHED_CALLER_PHONE,
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      undefined,
      undefined,
      'John Smith',
    );

    expect(results.map((r) => r.id).sort()).toEqual(
      [earlier.reservationId, later.reservationId].sort(),
    );
  });

  it('narrows name matches to the given check_out_date', async () => {
    const { earlier, earlierCheckout } = await seedSameNameDifferentCheckouts();

    const results = await service.getReservationDetails(
      UNMATCHED_CALLER_PHONE,
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      undefined,
      undefined,
      'John Smith',
      earlierCheckout,
    );

    expect(results.map((r) => r.id)).toEqual([earlier.reservationId]);
  });

  it('throws NoDataError when check_out_date excludes every name match', async () => {
    await seedSameNameDifferentCheckouts();

    await expect(
      service.getReservationDetails(
        UNMATCHED_CALLER_PHONE,
        RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
        undefined,
        undefined,
        'John Smith',
        dayjs().add(30, 'day').format('YYYY-MM-DD'),
      ),
    ).rejects.toThrow(/No reservation found/);
  });
});
