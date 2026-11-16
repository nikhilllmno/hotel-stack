import { NoDataError } from '@/errors/NoDataError';
import { installPostgresIntegrationTestContext } from '@/test/db/createPostgresIntegrationTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import {
  defaultStayDates,
  seedReservation,
} from '@/test/fixtures/reservationSeedFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import dayjs from 'dayjs';
import { RoomReservationService } from '../roomReservationService';

const DEFAULT_SEEDED_PHONE = '+15550001111';
const UNMATCHED_CALLER_PHONE = '+15559876543';

describe('RoomReservationService getReservationDetails lookup integration (postgres)', () => {
  const ctx = installPostgresIntegrationTestContext();
  let service: RoomReservationService;

  beforeEach(() => {
    ({ service } = createTestRoomReservationService({ knex: ctx.knex }));
  });

  it('returns name matches when phone lookup returns no results', async () => {
    const { checkIn, checkOut } = defaultStayDates();
    const seeded = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Reese',
      lastName: 'Roper',
    });

    const results = await service.getReservationDetails(
      UNMATCHED_CALLER_PHONE,
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      undefined,
      undefined,
      'Reece Roper',
    );

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(seeded.reservationId);
    expect(results[0].booking_id).toBe(seeded.bookingId);
    expect(results[0].customer.first_name).toBe('Reese');
    expect(results[0].customer.last_name).toBe('Roper');
  });

  it('throws NoDataError when last-digits phone lookup returns no results', async () => {
    const { checkIn, checkOut } = defaultStayDates();

    await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Reese',
      lastName: 'Roper',
    });

    await expect(
      service.getReservationDetails(
        UNMATCHED_CALLER_PHONE,
        RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
        undefined,
        '9999',
      ),
    ).rejects.toThrow(NoDataError);

    await expect(
      service.getReservationDetails(
        UNMATCHED_CALLER_PHONE,
        RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
        undefined,
        '9999',
      ),
    ).rejects.toThrow(
      'getReservationDetails: No reservation found for phone ending in 9999',
    );
  });

  it('returns booking id match when booking id and guest name are provided', async () => {
    const { checkIn, checkOut } = defaultStayDates();
    const seeded = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Reese',
      lastName: 'Roper',
    });
    await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Reece',
      lastName: 'Roper',
    });

    const results = await service.getReservationDetails(
      '',
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      seeded.bookingId,
      undefined,
      'Reece Roper',
    );

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(seeded.reservationId);
  });

  it('throws NoDataError when booking id lookup returns no results', async () => {
    const { checkIn, checkOut } = defaultStayDates();

    await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Reese',
      lastName: 'Roper',
    });

    await expect(
      service.getReservationDetails(
        '',
        RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
        'UNKNOWN-CONF-123',
        undefined,
        'Reece Roper',
      ),
    ).rejects.toThrow(NoDataError);

    await expect(
      service.getReservationDetails(
        '',
        RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
        'UNKNOWN-CONF-123',
        undefined,
        'Reece Roper',
      ),
    ).rejects.toThrow(
      'getReservationDetails: No reservation found for booking ID UNKNOWN-CONF-123',
    );
  });

  it('returns guest name matches when guest name is provided (caller phone ignored)', async () => {
    const { checkIn, checkOut } = defaultStayDates();
    const phoneMatch = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Reese',
      lastName: 'Roper',
    });
    const nameOnlyMatch = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Reece',
      lastName: 'Roper',
    });

    await ctx
      .knex('customers')
      .where({ id: nameOnlyMatch.customerId })
      .update({ phone_number: '+15554443333' });
    await ctx
      .knex('reservations')
      .where({ id: nameOnlyMatch.reservationId })
      .update({ phone_number: '+15554443333' });

    const results = await service.getReservationDetails(
      DEFAULT_SEEDED_PHONE,
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      undefined,
      undefined,
      'Reece Roper',
    );

    expect(results).toHaveLength(2);
    expect(results.map((reservation) => reservation.id).sort()).toEqual(
      [phoneMatch.reservationId, nameOnlyMatch.reservationId].sort(),
    );
  });

  it('returns guest name match when caller phone does not match', async () => {
    const { checkIn, checkOut } = defaultStayDates();
    await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Reese',
      lastName: 'Roper',
    });
    const nameMatch = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Carl',
      lastName: 'Smith',
    });

    await ctx
      .knex('customers')
      .where({ id: nameMatch.customerId })
      .update({ phone_number: '+15554443333' });
    await ctx
      .knex('reservations')
      .where({ id: nameMatch.reservationId })
      .update({ phone_number: '+15554443333' });

    const results = await service.getReservationDetails(
      UNMATCHED_CALLER_PHONE,
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      undefined,
      undefined,
      'Carl Smith',
    );

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(nameMatch.reservationId);
  });

  it('returns multiple reservations from guest name lookup alone', async () => {
    const firstStay = defaultStayDates();
    const secondStay = {
      checkIn: dayjs().add(10, 'day').format('YYYY-MM-DD'),
      checkOut: dayjs().add(12, 'day').format('YYYY-MM-DD'),
    };

    const firstBooking = await seedReservation(ctx.knex, {
      ...firstStay,
      firstName: 'Karl',
      lastName: 'Smith',
    });
    const secondBooking = await seedReservation(ctx.knex, {
      ...secondStay,
      customerId: firstBooking.customerId,
      firstName: 'Karl',
      lastName: 'Smith',
    });

    const results = await service.getReservationDetails(
      UNMATCHED_CALLER_PHONE,
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      undefined,
      undefined,
      'Karl Smith',
    );

    expect(results).toHaveLength(2);
    expect(results.map((reservation) => reservation.booking_id).sort()).toEqual(
      [firstBooking.bookingId, secondBooking.bookingId].sort(),
    );
  });

  it('throws NoDataError when guest name lookup finds no reservations', async () => {
    const { checkIn, checkOut } = defaultStayDates();

    await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Jane',
      lastName: 'Foobar',
    });

    await expect(
      service.getReservationDetails(
        UNMATCHED_CALLER_PHONE,
        RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
        undefined,
        undefined,
        'Reese Roper',
      ),
    ).rejects.toThrow(NoDataError);

    await expect(
      service.getReservationDetails(
        UNMATCHED_CALLER_PHONE,
        RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
        undefined,
        undefined,
        'Reese Roper',
      ),
    ).rejects.toThrow(
      'getReservationDetails: No reservation found for guest name "Reese Roper"',
    );
  });
});
