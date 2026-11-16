import { CancellationSource } from '@/dtos/enum/CancellationSource';
import { ReservationSource } from '@/dtos/enum/ReservationSource';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import { BadRequestError } from '@/errors/BadRequestError';
import { TelegramNotificationService } from '@/services/notification';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import {
  EXTERNAL_DIRECT_FIXTURE_IDS,
  seedExternalDirectReservation,
} from '@/test/fixtures/externalDirectReservationFixture';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { StubPmsReservationService } from '@/test/stubs/StubPmsReservationService';
import { RoomReservationService } from '../roomReservationService';

describe('RoomReservationService.cancelReservation external direct website bookings', () => {
  const ctx = installPgMemTestContext();
  let service: RoomReservationService;
  let pmsReservationService: StubPmsReservationService;
  let telegramNotificationService: TelegramNotificationService;

  beforeEach(() => {
    pmsReservationService = new StubPmsReservationService();
    const bundle = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: { pmsReservationService },
    });
    service = bundle.service;
    telegramNotificationService =
      bundle.externalStubs.telegramNotificationService;
  });

  it('cancels an active external direct reservation in PMS without updating local DB status', async () => {
    const fixture = await seedExternalDirectReservation(ctx.knex, {
      status: ReservationStatus.ACTIVE,
    });

    const result = await service.cancelReservation(
      fixture.externalId,
      CancellationSource.CUSTOMER,
      undefined,
      'Guest requested cancellation',
      fixture.hotelId,
    );

    expect(
      pmsReservationService.cancelExternalDirectReservation,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        id: fixture.reservationId,
        external_id: fixture.externalId,
        type: SessionType.EXTERNAL,
        reservation_source: ReservationSource.DIRECT_HOTEL_RESERVATION,
      }),
      'Guest requested cancellation',
    );
    expect(pmsReservationService.cancelReservation).not.toHaveBeenCalled();
    expect(result.errors).toEqual([]);
    expect(result.reservationCancelResult.status).toBe(
      ReservationStatus.ACTIVE,
    );

    const unchangedReservation = await ctx
      .knex('reservations')
      .where({ id: fixture.reservationId })
      .first();

    expect(unchangedReservation.status).toBe(ReservationStatus.ACTIVE);
    expect(unchangedReservation.previous_status).toBe(ReservationStatus.ACTIVE);
  });

  it('sends a telegram alert for customer-initiated active external direct cancellations', async () => {
    const fixture = await seedExternalDirectReservation(ctx.knex, {
      status: ReservationStatus.ACTIVE,
    });

    await service.cancelReservation(
      fixture.externalId,
      CancellationSource.CUSTOMER,
      undefined,
      undefined,
      fixture.hotelId,
    );

    expect(telegramNotificationService.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: '-1001234567890',
        content: expect.objectContaining({
          parseMode: 'MarkdownV2',
          message: expect.stringContaining('Booking Cancelled'),
        }),
      }),
    );
  });

  it('rejects cancellation when the external direct reservation is not active', async () => {
    await seedExternalDirectReservation(ctx.knex, {
      status: ReservationStatus.INACTIVE,
    });

    await expect(
      service.cancelReservation(
        EXTERNAL_DIRECT_FIXTURE_IDS.externalId,
        CancellationSource.SYSTEM,
        undefined,
        undefined,
        RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      ),
    ).rejects.toThrow(
      'cancelExternalDirectReservation: Reservation 8018156056034 is not active. Cannot cancel',
    );

    expect(
      pmsReservationService.cancelExternalDirectReservation,
    ).not.toHaveBeenCalled();
  });

  it('rejects cancellation of third-party external reservations', async () => {
    await seedExternalDirectReservation(ctx.knex, {
      reservationSource: ReservationSource.THIRD_PARTY_RESERVATION,
      status: ReservationStatus.ACTIVE,
    });

    await expect(
      service.cancelReservation(
        EXTERNAL_DIRECT_FIXTURE_IDS.externalId,
        CancellationSource.CUSTOMER,
        undefined,
        undefined,
        RESERVATION_FLOW_FIXTURE_IDS.hotelId,
      ),
    ).rejects.toThrow(BadRequestError);

    expect(
      pmsReservationService.cancelExternalDirectReservation,
    ).not.toHaveBeenCalled();
  });
});
