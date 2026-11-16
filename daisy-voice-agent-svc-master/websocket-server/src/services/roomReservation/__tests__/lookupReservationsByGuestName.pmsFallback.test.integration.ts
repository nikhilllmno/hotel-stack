process.env.STAYNTOUCH_BASE_URL = 'https://api.stayntouch.test/connect';

import { Reservation as ReservationDTO } from '@/dtos/Reservation';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
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
import dayjs from 'dayjs';
import { RoomReservationService } from '../roomReservationService';

const UNMATCHED_CALLER_PHONE = '+15559876543';

function buildPmsReservationDto(params: {
  id: string;
  firstName: string;
  lastName: string;
}): ReservationDTO {
  const { checkIn, checkOut } = defaultStayDates();

  return {
    id: params.id,
    booking_id: `EXT-${params.id}`,
    phone_number: '+15550009999',
    type: SessionType.EXTERNAL,
    room_id: 101,
    room_type: 'Standard',
    business_id: RESERVATION_FLOW_FIXTURE_IDS.businessId,
    hotel_id: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
    pms_provider: PmsProvider.STAYNTOUCH,
    status: ReservationStatus.ACTIVE,
    check_in: dayjs(checkIn).toDate(),
    check_out: dayjs(checkOut).toDate(),
    num_adults: 2,
    num_children: 0,
    customer: {
      hotel_id: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      first_name: params.firstName,
      last_name: params.lastName,
      phone_number: '+15550009999',
      email: 'guest@test.com',
    },
    hotel: null,
    hotel_configuration: null,
    channel: null,
    payments: null,
    quote: null,
    discount: null,
  };
}

describe('lookupReservationsByGuestName Stayntouch PMS fallback integration (postgres)', () => {
  const ctx = installPostgresIntegrationTestContext();
  let service: RoomReservationService;
  let pmsLookupSpy: jest.SpyInstance;

  beforeEach(async () => {
    await ctx
      .knex('hotels')
      .where({ id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
      .update({ pms_provider: PmsProvider.STAYNTOUCH });

    const stayntouchService = new StayntouchReservationService(
      RESERVATION_FLOW_FIXTURE_IDS.hotelId,
    );
    pmsLookupSpy = jest
      .spyOn(stayntouchService, 'lookupReservationsByGuestQueryFromPms')
      .mockResolvedValue([
        buildPmsReservationDto({
          id: 'pms-match',
          firstName: 'Reese',
          lastName: 'Roper',
        }),
      ]);

    const pmsServiceFactory = {
      getReservationService: jest.fn().mockResolvedValue(stayntouchService),
    } as unknown as PMSServiceFactory;

    ({ service } = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: { pmsServiceFactory },
    }));
  });

  afterEach(() => {
    pmsLookupSpy.mockRestore();
  });

  it('uses Stayntouch query fallback when DB guest search is empty', async () => {
    const { checkIn, checkOut } = defaultStayDates();

    await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Jane',
      lastName: 'Foobar',
    });

    const results = await service.getReservationDetails(
      UNMATCHED_CALLER_PHONE,
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      undefined,
      undefined,
      'Reece Roper',
    );

    expect(pmsLookupSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: RESERVATION_FLOW_FIXTURE_IDS.hotelId }),
      'Reece Roper',
    );
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('pms-match');
    expect(results[0].customer.first_name).toBe('Reese');
    expect(results[0].customer.last_name).toBe('Roper');
  });
});
