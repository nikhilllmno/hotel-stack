import { CancellationSource } from '@/dtos/enum/CancellationSource';
import { ReservationPaymentStatus } from '@/dtos/enum/ReservationPaymentStatus';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import {
  defaultStayDates,
  seedReservation,
} from '@/test/fixtures/reservationSeedFixture';
import {
  createTestRoomReservationService,
  TestRoomReservationServiceBundle,
} from '@/test/stubs/createTestRoomReservationService';
import { StubPmsReservationService } from '@/test/stubs/StubPmsReservationService';
import { RoomReservationService } from '../roomReservationService';

const TELEGRAM_ALERTS_GROUP_ID = '-1009876543210';

describe('RoomReservationService.cancelReservation native reservations - PMS source', () => {
  const ctx = installPgMemTestContext();
  let service: RoomReservationService;
  let pmsReservationService: StubPmsReservationService;
  let externalStubs: TestRoomReservationServiceBundle['externalStubs'];

  beforeEach(async () => {
    await ctx
      .knex('hotels')
      .where({ id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
      .update({ telegram_alerts_group_id: TELEGRAM_ALERTS_GROUP_ID });

    pmsReservationService = new StubPmsReservationService();
    const bundle = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: { pmsReservationService },
    });
    service = bundle.service;
    externalStubs = bundle.externalStubs;
  });

  it('cancels a native reservation without calling the PMS when source is PMS', async () => {
    const { checkIn, checkOut } = defaultStayDates();
    const fixture = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Jamie',
      lastName: 'Rivera',
    });

    const { reservationCancelResult } = await service.cancelReservation(
      fixture.bookingId,
      CancellationSource.PMS,
      undefined,
      'Cancelled in Cloudbeds',
      fixture.hotelId,
    );

    expect(pmsReservationService.cancelReservation).not.toHaveBeenCalled();
    expect(reservationCancelResult.status).toBe(ReservationStatus.CANCELLED);

    const updatedReservation = await ctx
      .knex('reservations')
      .where({ id: fixture.reservationId })
      .first();
    expect(updatedReservation.status).toBe(ReservationStatus.CANCELLED);
    expect(updatedReservation.previous_status).toBe(ReservationStatus.ACTIVE);
    expect(updatedReservation.payment_status).toBe(
      ReservationPaymentStatus.REVIEW_PENDING,
    );
  });

  it('still sends the review-refund telegram alert and guest SMS for PMS-sourced cancellations', async () => {
    const { checkIn, checkOut } = defaultStayDates();
    const fixture = await seedReservation(ctx.knex, {
      checkIn,
      checkOut,
      firstName: 'Jamie',
      lastName: 'Rivera',
    });

    await service.cancelReservation(
      fixture.bookingId,
      CancellationSource.PMS,
      undefined,
      'Cancelled in Cloudbeds',
      fixture.hotelId,
    );

    expect(
      externalStubs.telegramNotificationService.sendMessage,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: TELEGRAM_ALERTS_GROUP_ID,
        content: expect.objectContaining({
          parseMode: 'MarkdownV2',
          message: expect.stringContaining('Booking Cancelled'),
        }),
      }),
    );
    expect(externalStubs.smsService.sendMessage).toHaveBeenCalledTimes(1);
  });
});
