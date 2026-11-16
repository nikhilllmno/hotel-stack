import { CloudbedsReservationSyncService } from '@/cloudbeds/services/CloudbedsReservationSyncService';
import { ReservationSource } from '@/dtos/enum/ReservationSource';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import { Reservation } from '@/models/Reservation';
import { CustomerService } from '@/services/customer/customerService';
import { SessionService } from '@/services/session/SessionService';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';

function buildReservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: 'res-uuid-1',
    booking_id: 'BK12345',
    business_id: '12345',
    hotel_id: 'hotel-uuid-1',
    pms_provider: 'cloudbeds',
    room_id: 100,
    customer_id: 'cust-uuid-1',
    check_in: new Date('2026-07-05'),
    check_out: new Date('2026-07-08'),
    num_adults: 2,
    num_children: 0,
    phone_number: '+15551234567',
    status: ReservationStatus.ACTIVE,
    room_type: 'Deluxe King',
    external_id: '31415926',
    type: SessionType.CALL,
    source: ReservationSource.DIRECT_HOTEL_RESERVATION,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('CloudbedsReservationSyncService.isDaisyOriginatedReservation', () => {
  const ctx = installPgMemTestContext();

  function createService(): CloudbedsReservationSyncService {
    const { service: roomReservationService } =
      createTestRoomReservationService({
        knex: ctx.knex,
      });
    return new CloudbedsReservationSyncService(
      {} as SessionService,
      {} as CustomerService,
      roomReservationService,
    );
  }

  const daisySessionTypes = Object.values(SessionType).filter(
    (type) => type !== SessionType.EXTERNAL,
  );

  it.each(daisySessionTypes)(
    'returns true for a %s reservation booked as a direct hotel reservation',
    (type) => {
      const service = createService();

      expect(
        service.isDaisyOriginatedReservation(buildReservation({ type })),
      ).toBe(true);
    },
  );

  it('returns false when the reservation type is EXTERNAL', () => {
    const service = createService();

    expect(
      service.isDaisyOriginatedReservation(
        buildReservation({ type: SessionType.EXTERNAL }),
      ),
    ).toBe(false);
  });

  it('returns false when the source is not a direct hotel reservation', () => {
    const service = createService();

    expect(
      service.isDaisyOriginatedReservation(
        buildReservation({ source: ReservationSource.THIRD_PARTY_RESERVATION }),
      ),
    ).toBe(false);
  });
});
