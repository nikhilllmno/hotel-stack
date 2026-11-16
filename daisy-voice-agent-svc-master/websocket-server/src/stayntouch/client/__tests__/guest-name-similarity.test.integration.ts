import { Reservation as ReservationDTO } from '@/dtos/Reservation';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import {
  filterReservationsByGuestNameSimilarity,
  isGuestNameSimilar,
} from '@/stayntouch/client/guest-name-similarity';
import { installPostgresIntegrationTestContext } from '@/test/db/createPostgresIntegrationTestContext';
import dayjs from 'dayjs';

function buildReservationDto(params: {
  id: string;
  firstName: string;
  lastName: string;
}): ReservationDTO {
  const checkIn = dayjs().add(1, 'day').toDate();
  const checkOut = dayjs().add(3, 'day').toDate();

  return {
    id: params.id,
    booking_id: `BK-${params.id}`,
    phone_number: '+15550001111',
    type: SessionType.EXTERNAL,
    room_id: 101,
    room_type: 'Standard',
    business_id: '1001',
    hotel_id: '22222222-2222-2222-2222-222222222222',
    pms_provider: 'stayntouch',
    status: ReservationStatus.ACTIVE,
    check_in: checkIn,
    check_out: checkOut,
    num_adults: 2,
    num_children: 0,
    customer: {
      hotel_id: '22222222-2222-2222-2222-222222222222',
      first_name: params.firstName,
      last_name: params.lastName,
      phone_number: '+15550001111',
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

describe('guest-name-similarity integration (postgres)', () => {
  installPostgresIntegrationTestContext();

  it('matches typo first names like the DB guest search path', async () => {
    await expect(
      isGuestNameSimilar('Reece Roper', 'Reese', 'Roper'),
    ).resolves.toBe(true);
    await expect(
      isGuestNameSimilar('Reece Roper', 'Jane', 'Foobar'),
    ).resolves.toBe(false);
  });

  it('filters PMS candidate reservations to similar guest names only', async () => {
    const matching = buildReservationDto({
      id: 'match-1',
      firstName: 'Reese',
      lastName: 'Roper',
    });
    const nonMatching = buildReservationDto({
      id: 'noise-1',
      firstName: 'Jane',
      lastName: 'Foobar',
    });

    const filtered = await filterReservationsByGuestNameSimilarity(
      'Reece Roper',
      [matching, nonMatching],
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('match-1');
  });
});
