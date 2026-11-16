process.env.STAYNTOUCH_BASE_URL = 'https://api.stayntouch.test/connect';

import { PMSServiceFactory } from '@/pms/PMSServiceFactory';
import { StayntouchReservationService } from '@/stayntouch/services/reservationService';
import { installPostgresIntegrationTestContext } from '@/test/db/createPostgresIntegrationTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import {
  defaultStayDates,
  seedReservation,
} from '@/test/fixtures/reservationSeedFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { PmsProvider } from '@/types/enums';
import { RoomReservationService } from '../roomReservationService';

const DEFAULT_SEEDED_PHONE = '+15550001111';
const LAST_DIGITS = '1111';

describe('RoomReservationService getReservationDetails lastDigits PMS timeout integration (postgres)', () => {
  const ctx = installPostgresIntegrationTestContext();
  let service: RoomReservationService;
  let stayntouchPhoneLookupSpy: jest.SpyInstance;

  beforeEach(async () => {
    await ctx
      .knex('hotels')
      .where({ id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
      .update({ pms_provider: PmsProvider.STAYNTOUCH });

    const stayntouchService = new StayntouchReservationService(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
    );
    stayntouchPhoneLookupSpy = jest
      .spyOn(stayntouchService, 'lookupReservationsByPhone')
      .mockRejectedValue(
        new Error('lookupPmsReservationsByPhone timed out after 12000ms'),
      );

    const pmsServiceFactory = {
      getReservationService: jest.fn().mockResolvedValue(stayntouchService),
    } as unknown as PMSServiceFactory;

    ({ service } = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: { pmsServiceFactory },
    }));
  });

  afterEach(() => {
    stayntouchPhoneLookupSpy.mockRestore();
  });

  it('returns local DB reservation when Stayntouch phone lookup times out', async () => {
    const { checkIn, checkOut } = defaultStayDates();
    const seeded = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Reese',
      lastName: 'Roper',
    });

    const results = await service.getReservationDetails(
      DEFAULT_SEEDED_PHONE,
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      undefined,
      LAST_DIGITS,
    );

    expect(stayntouchPhoneLookupSpy).toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(seeded.reservationId);
    expect(results[0].booking_id).toBe(seeded.bookingId);
  });
});
