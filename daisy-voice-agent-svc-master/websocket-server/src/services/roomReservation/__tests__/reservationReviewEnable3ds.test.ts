import { SessionType } from '@/dtos/enum/SessionType';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { StubPmsReservationService } from '@/test/stubs/StubPmsReservationService';
import { PaymentProvider } from '@/types/enums';
import { RoomReservationService } from '../roomReservationService';

describe('getReservationDetailsByReviewId hotel.enable_3ds', () => {
  const ctx = installPgMemTestContext();
  let service: RoomReservationService;

  beforeEach(() => {
    const bundle = createTestRoomReservationService({
      externalStubs: { pmsReservationService: new StubPmsReservationService() },
      knex: ctx.knex,
    });
    service = bundle.service;
  });

  async function createReviewId(): Promise<string> {
    const created = await service.createSingleRoomReservation(
      {
        check_in: '2099-01-07',
        check_out: '2099-01-09',
        customer_first_name: 'Test',
        customer_last_name: 'Guest',
        customer_phone_number: '+15559876543',
        num_adults: 2,
        room_id: 101,
        session_type: SessionType.SMS,
      } as any,
      '+15559876543',
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      '77777777-7777-7777-7777-777777777777',
      SessionType.SMS,
    );
    const bookingReviewRow = await ctx
      .knex('booking_reviews')
      .where({ booking_id: created.booking_id })
      .first();
    return bookingReviewRow.reservation_review_id;
  }

  async function setHotel(
    provider: PaymentProvider,
    threeDSConfig: { enabled: boolean } | null,
  ) {
    await ctx
      .knex('hotels')
      .where({ id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
      .update({ payment_provider: provider });
    await ctx
      .knex('hotel_configurations')
      .where({ hotel_id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
      .update({
        threeDS_config: threeDSConfig ? JSON.stringify(threeDSConfig) : null,
      });
  }

  it('is null for a non-Shift4 hotel', async () => {
    const reviewId = await createReviewId();
    await setHotel(PaymentProvider.STRIPE, { enabled: true });

    const details = await service.getReservationDetailsByReviewId(reviewId);
    expect(details.hotel?.enable_3ds).toBeNull();
  });

  it('is null for a Shift4 hotel without threeDS_config', async () => {
    const reviewId = await createReviewId();
    await setHotel(PaymentProvider.SHIFT4, null);

    const details = await service.getReservationDetailsByReviewId(reviewId);
    expect(details.hotel?.enable_3ds).toBeNull();
  });

  it('is true for a Shift4 hotel with threeDS_config enabled', async () => {
    const reviewId = await createReviewId();
    await setHotel(PaymentProvider.SHIFT4, { enabled: true });

    const details = await service.getReservationDetailsByReviewId(reviewId);
    expect(details.hotel?.enable_3ds).toBe(true);
  });

  it('is false for a Shift4 hotel with threeDS_config disabled', async () => {
    const reviewId = await createReviewId();
    await setHotel(PaymentProvider.SHIFT4, { enabled: false });

    const details = await service.getReservationDetailsByReviewId(reviewId);
    expect(details.hotel?.enable_3ds).toBe(false);
  });
});
