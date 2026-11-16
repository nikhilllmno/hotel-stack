jest.mock('@/mews/services/MewsPaymentProviderService', () => ({
  __esModule: true,
  default: {
    processCardPayment: jest.fn(),
    captureCardWithoutCharge: jest.fn(),
    getPublicKey: jest.fn(),
  },
}));

import { PaymentStatus } from '@/dtos/enum/PaymentStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import mewsPaymentProviderService from '@/mews/services/MewsPaymentProviderService';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { StubPmsReservationService } from '@/test/stubs/StubPmsReservationService';
import { PaymentProvider } from '@/types/enums';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Knex } from 'knex';
import { RoomReservationService } from '../roomReservationService';

dayjs.extend(utc);
dayjs.extend(timezone);

const HOTEL_TZ = 'America/New_York';

async function seedMewsHotel(knex: Knex, cutoffTime: string) {
  await knex('hotels')
    .where({ id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
    .update({ payment_provider: PaymentProvider.MEWS, updated_at: new Date() });

  await knex('hotel_configurations')
    .where({ hotel_id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
    .update({
      same_day_booking_configuration: JSON.stringify({
        allow_same_day_checkin: true,
        cutoff_time: cutoffTime,
        transfer_to_manager_for_same_day: false,
      }),
      updated_at: new Date(),
    });
}

/**
 * A cutoff that has already passed in the hotel's timezone. The guard compares
 * wall-clock HH:mm within the same day, so clamp to the start of day rather than
 * wrapping to the previous day when run within the first two hours after midnight.
 */
function cutoffAlreadyPassed(): string {
  const now = dayjs().tz(HOTEL_TZ);
  const candidate = now.subtract(2, 'hour');
  return candidate.isSame(now, 'day') ? candidate.format('HH:mm') : '00:00';
}

/**
 * A cutoff still ahead in the hotel's timezone. Clamp to the end of day rather
 * than wrapping to the next day when run within the last two hours before midnight.
 */
function cutoffStillAhead(): string {
  const now = dayjs().tz(HOTEL_TZ);
  const candidate = now.add(2, 'hour');
  return candidate.isSame(now, 'day') ? candidate.format('HH:mm') : '23:59';
}

async function createSameDayReservation(service: RoomReservationService) {
  const today = dayjs().tz(HOTEL_TZ);
  return service.createSingleRoomReservation(
    {
      check_in: today.format('YYYY-MM-DD'),
      check_out: today.add(1, 'day').format('YYYY-MM-DD'),
      customer_first_name: 'Jane',
      customer_last_name: 'Doe',
      customer_phone_number: '+15559876543',
      num_adults: 2,
      room_id: 101,
      session_type: SessionType.SMS,
    } as never,
    '+15559876543',
    RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
    '77777777-7777-7777-7777-777777777777',
    SessionType.SMS,
  );
}

describe('Mews same-day cutoff guard runs before the card is captured', () => {
  const ctx = installPgMemTestContext();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not capture or charge the card when the cutoff has passed', async () => {
    // Cutoff is checked when availability is quoted, but the guest can pay up to
    // REVIEW_TIMEOUT later. Seeding the reservation first and only then moving the
    // cutoff into the past reproduces that window.
    await seedMewsHotel(ctx.knex, cutoffStillAhead());

    const { service } = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: {
        pmsReservationService: new StubPmsReservationService({
          quote: {
            amountCharged: 0,
            base_rate: 100,
            fees: 0,
            taxes: 0,
            total_amount: 100,
          },
        }),
      },
    });

    const created = await createSameDayReservation(service);
    const bookingReviewRow = await ctx
      .knex('booking_reviews')
      .where({ booking_id: created.booking_id })
      .first();
    const paymentRow = await ctx
      .knex('payments')
      .where({ hotel_id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
      .first();

    await seedMewsHotel(ctx.knex, cutoffAlreadyPassed());

    await expect(
      service.processMewsPaymentAndCreateReservations({
        reservation_review_id: bookingReviewRow.reservation_review_id,
        card_token: 'tok-1',
        expiry_month: '12',
        expiry_year: '2030',
      } as never),
    ).rejects.toThrow(/same-day/i);

    // The whole point of the guard's position: no money moved.
    expect(
      mewsPaymentProviderService.captureCardWithoutCharge,
    ).not.toHaveBeenCalled();
    expect(
      mewsPaymentProviderService.processCardPayment,
    ).not.toHaveBeenCalled();

    const paymentAfter = await ctx
      .knex('payments')
      .where({ id: paymentRow.id })
      .first();
    expect(paymentAfter.payment_status).not.toBe(PaymentStatus.COMPLETED);
  });
});
