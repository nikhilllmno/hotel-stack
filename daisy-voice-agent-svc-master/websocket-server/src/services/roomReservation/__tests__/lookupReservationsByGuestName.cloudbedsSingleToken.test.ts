import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import {
  defaultStayDates,
  seedReservation,
} from '@/test/fixtures/reservationSeedFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { PmsProvider } from '@/types/enums';
import { RoomReservationService } from '../roomReservationService';

const UNMATCHED_CALLER_PHONE = '+15559876543';

describe('RoomReservationService.getReservationDetails single-token guest name DB lookup', () => {
  const ctx = installPgMemTestContext();
  let service: RoomReservationService;

  beforeEach(() => {
    ({ service } = createTestRoomReservationService({ knex: ctx.knex }));
  });

  async function seedNameCrossoverGuests() {
    const { checkIn, checkOut } = defaultStayDates();

    // 'Bailey' is a first name for one guest and a last name for the other,
    // so a single-token query for 'Bailey' distinguishes matching either
    // field (default) from matching last name only (Cloudbeds).
    const firstNameMatch = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Bailey',
      lastName: 'Foster',
    });
    const lastNameMatch = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Reese',
      lastName: 'Bailey',
    });

    return { firstNameMatch, lastNameMatch };
  }

  it('matches a single-token name against either first or last name for non-Cloudbeds hotels', async () => {
    const { firstNameMatch, lastNameMatch } = await seedNameCrossoverGuests();

    const results = await service.getReservationDetails(
      UNMATCHED_CALLER_PHONE,
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      undefined,
      undefined,
      'Bailey',
    );

    expect(results.map((r) => r.id).sort()).toEqual(
      [firstNameMatch.reservationId, lastNameMatch.reservationId].sort(),
    );
  });

  it('matches a single-token name against last name only for Cloudbeds hotels', async () => {
    await ctx
      .knex('hotels')
      .where({ id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
      .update({ pms_provider: PmsProvider.CLOUDBEDS });

    const { lastNameMatch } = await seedNameCrossoverGuests();

    const results = await service.getReservationDetails(
      UNMATCHED_CALLER_PHONE,
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      undefined,
      undefined,
      'Bailey',
    );

    expect(results.map((r) => r.id)).toEqual([lastNameMatch.reservationId]);
  });
});
