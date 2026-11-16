import { Reservation as ReservationDTO } from '@/dtos/Reservation';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import {
  defaultStayDates,
  seedReservation,
} from '@/test/fixtures/reservationSeedFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { PmsProvider } from '@/types/enums';
import { RoomReservationService } from '../roomReservationService';

const SEEDED_PHONE = '+15550001111';
const ASSISTANT_PHONE = RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber;

function buildPmsReservation(
  overrides: Partial<ReservationDTO> & {
    externalId: string;
    hotelId: string;
    checkIn: string;
    checkOut: string;
  },
): ReservationDTO {
  return {
    id: 'cloudbeds-live-id-should-not-win',
    booking_id: 'PMS-BOOKING-ID-SHOULD-NOT-WIN',
    external_id: overrides.externalId,
    phone_number: SEEDED_PHONE,
    type: SessionType.EXTERNAL,
    room_id: 674378,
    room_type: 'Deluxe King',
    room_name: 'DK(3)',
    room_number: '3',
    business_id: RESERVATION_FLOW_FIXTURE_IDS.businessId,
    hotel_id: overrides.hotelId,
    pms_provider: PmsProvider.CLOUDBEDS,
    status: ReservationStatus.ACTIVE,
    check_in: new Date(overrides.checkIn),
    check_out: new Date(overrides.checkOut),
    num_adults: 1,
    num_children: 0,
    customer: { phone_number: SEEDED_PHONE, hotel_id: overrides.hotelId },
    hotel: null,
    hotel_configuration: null,
    channel: null,
    payments: null,
    quote: null,
    discount: null,
    ...overrides,
  };
}

describe('RoomReservationService.getReservationDetails guest_name room data refresh', () => {
  const ctx = installPgMemTestContext();
  let service: RoomReservationService;

  it('fills in room_name/room_number via by-ID refresh for a guest_name lookup (Cloudbeds)', async () => {
    const { service: testService, externalStubs } =
      createTestRoomReservationService({ knex: ctx.knex });
    service = testService;
    const { pmsReservationService } = externalStubs;

    await ctx
      .knex('hotels')
      .where({ id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
      .update({ pms_provider: PmsProvider.CLOUDBEDS });

    const { checkIn, checkOut } = defaultStayDates();
    const seeded = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'DaisyDoor',
      lastName: 'TestFlow',
      externalId: 'CB-GUEST-NAME-RES-1',
    });

    // This stub is never recognized by the `instanceof CloudbedsReservationService`
    // check inside lookupReservationsByGuestName, so the live guest-name PMS
    // search always comes back empty here — same as prod whenever that search
    // doesn't happen to match. This isolates the by-ID refresh as the only
    // source of room data, proving it alone (not a lucky name-search match)
    // is what supplies room_name/room_number for this path.
    pmsReservationService.lookupReservationsById.mockResolvedValueOnce([
      buildPmsReservation({
        externalId: 'CB-GUEST-NAME-RES-1',
        hotelId: seeded.hotelId,
        checkIn,
        checkOut,
      }),
    ]);

    const results = await service.getReservationDetails(
      SEEDED_PHONE,
      ASSISTANT_PHONE,
      undefined, // bookingId
      undefined, // lastDigitsPhoneNumber
      'DaisyDoor TestFlow', // guestName — this is the path under test
    );

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(seeded.reservationId);
    expect(results[0].booking_id).toBe(seeded.bookingId);
    expect(results[0].room_name).toBe('DK(3)');
    expect(results[0].room_number).toBe('3');
    expect(pmsReservationService.lookupReservationsById).toHaveBeenCalledWith(
      expect.anything(),
      'CB-GUEST-NAME-RES-1',
    );
  });
});
