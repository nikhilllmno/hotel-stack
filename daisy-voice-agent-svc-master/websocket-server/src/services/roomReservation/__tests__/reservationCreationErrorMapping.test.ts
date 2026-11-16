import { SessionType } from '@/dtos/enum/SessionType';
import { BadRequestError } from '@/errors/BadRequestError';
import { NoDataError } from '@/errors/NoDataError';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { createTestPaymentService } from '@/test/stubs/createTestPaymentService';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { StubPaymentProviderService } from '@/test/stubs/StubPaymentProviderService';
import dayjs from 'dayjs';

const checkIn = () => dayjs().add(7, 'day').format('YYYY-MM-DD');
const checkOut = () => dayjs().add(9, 'day').format('YYYY-MM-DD');

describe('RoomReservationService reservation-creation error mapping', () => {
  const ctx = installPgMemTestContext();

  it('createMultiRoomReservation: missing caller phone number throws BadRequestError (400), not a generic Error', async () => {
    const { service } = createTestRoomReservationService({ knex: ctx.knex });

    await expect(
      service.createMultiRoomReservation(
        {
          check_in: checkIn(),
          check_out: checkOut(),
          customer_first_name: 'Test',
          customer_last_name: 'Guest',
          customer_phone_number: '+15559876543',
          people_per_room: { '101': [{ num_adults: 1, num_children: 0 }] },
          room_ids: [101],
          session_type: SessionType.CHAT,
        },
        '', // caller's own phone number — empty for a CHAT session
        RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
        '77777777-7777-7777-7777-777777777777',
        SessionType.CHAT,
      ),
    ).rejects.toThrow(BadRequestError);
  });

  it('createSingleRoomReservation: a payment provider returning no payment link throws NoDataError (404), not a generic Error', async () => {
    const paymentBundle = createTestPaymentService({
      knex: ctx.knex,
      paymentProviderService: new StubPaymentProviderService({
        paymentLinkUrl: '',
      }),
    });
    const { service } = createTestRoomReservationService({
      knex: ctx.knex,
      paymentBundle,
    });

    await expect(
      service.createSingleRoomReservation(
        {
          check_in: checkIn(),
          check_out: checkOut(),
          customer_first_name: 'Test',
          customer_last_name: 'Guest',
          customer_phone_number: '+15559876543',
          num_adults: 2,
          room_id: 101,
          session_type: SessionType.SMS,
        },
        '+15559876543',
        RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
        '77777777-7777-7777-7777-777777777777',
        SessionType.SMS,
      ),
    ).rejects.toThrow(NoDataError);
  });
});
