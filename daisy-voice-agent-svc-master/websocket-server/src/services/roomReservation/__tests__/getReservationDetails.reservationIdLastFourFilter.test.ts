import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { seedReservation } from '@/test/fixtures/reservationSeedFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import dayjs from 'dayjs';
import { RoomReservationService } from '../roomReservationService';

const UNMATCHED_CALLER_PHONE = '+15559876543';

describe('RoomReservationService.getReservationDetails reservation_id_last_four filter', () => {
  const ctx = installPgMemTestContext();
  let service: RoomReservationService;

  beforeEach(() => {
    ({ service } = createTestRoomReservationService({ knex: ctx.knex }));
  });

  async function seedSameNameAndCheckout() {
    const checkIn = dayjs().add(1, 'day').format('YYYY-MM-DD');
    const checkOut = dayjs().add(3, 'day').format('YYYY-MM-DD');

    const first = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'John',
      lastName: 'Smith',
    });
    const second = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'John',
      lastName: 'Smith',
    });

    return { first, second, checkOut };
  }

  it('narrows name + checkout matches to the reservation id last four', async () => {
    const { first, checkOut } = await seedSameNameAndCheckout();

    const results = await service.getReservationDetails(
      UNMATCHED_CALLER_PHONE,
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      undefined,
      undefined,
      'John Smith',
      checkOut,
      first.reservationId.slice(-4),
    );

    expect(results.map((r) => r.id)).toEqual([first.reservationId]);
  });

  it('matches the reservation id case-insensitively', async () => {
    const { first, checkOut } = await seedSameNameAndCheckout();

    const results = await service.getReservationDetails(
      UNMATCHED_CALLER_PHONE,
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      undefined,
      undefined,
      'John Smith',
      checkOut,
      first.reservationId.slice(-4).toUpperCase(),
    );

    expect(results.map((r) => r.id)).toEqual([first.reservationId]);
  });

  it('throws NoDataError when the last four excludes every match', async () => {
    const { checkOut } = await seedSameNameAndCheckout();

    await expect(
      service.getReservationDetails(
        UNMATCHED_CALLER_PHONE,
        RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
        undefined,
        undefined,
        'John Smith',
        checkOut,
        'zzzz',
      ),
    ).rejects.toThrow(/No reservation found/);
  });
});
