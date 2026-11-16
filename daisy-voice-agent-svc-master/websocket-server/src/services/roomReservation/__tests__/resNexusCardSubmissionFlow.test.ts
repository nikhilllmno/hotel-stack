/**
 * End to end for the ResNexus card route: the card posted by the guest reaches
 * `addreservation` and nowhere else, and every way the submission can be too
 * late or wrong is refused before the call is made.
 */
import config from '@/config';
import { ReservationPaymentStatus } from '@/dtos/enum/ReservationPaymentStatus';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { PmsBookingOutcomeUnknownError } from '@/errors/PmsBookingOutcomeUnknownError';
import failedCardCheckLimiter from '@/services/cardVerification/failedCardCheckLimiter';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { createResNexusCardBooking } from '@/test/fixtures/resNexusCardBookingFixture';
import { TestPaymentServiceBundle } from '@/test/stubs/createTestPaymentService';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { StubPmsReservationService } from '@/test/stubs/StubPmsReservationService';
import { PaymentProvider } from '@/types/enums';
import { KpiStat, logKpi } from '@/utils/kpiLogger';
import { ResNexusCardRequest } from '@/validators/cardSubmissionSchema';
import { randomUUID } from 'crypto';
import dayjs from 'dayjs';
import { RoomReservationService } from '../roomReservationService';

jest.mock('@/utils/kpiLogger', () => ({
  ...jest.requireActual('@/utils/kpiLogger'),
  logKpi: jest.fn(),
}));

const PAN = '4111111111111111';
const CVV = '737';

describe('ResNexus card submission flow', () => {
  const ctx = installPgMemTestContext();
  const { hotelId } = RESERVATION_FLOW_FIXTURE_IDS;

  let service: RoomReservationService;
  let paymentBundle: TestPaymentServiceBundle;
  let pmsStub: StubPmsReservationService;
  let sendSms: jest.Mock;
  let sendTelegram: jest.Mock;

  const ORIGINAL_VERIFY_LOGIN_ID = config.AUTHORIZE_NET_VERIFY_API_LOGIN_ID;
  const ORIGINAL_VERIFY_KEY = config.AUTHORIZE_NET_VERIFY_TRANSACTION_KEY;

  beforeEach(() => {
    config.AUTHORIZE_NET_VERIFY_API_LOGIN_ID = 'verify-login';
    config.AUTHORIZE_NET_VERIFY_TRANSACTION_KEY = 'verify-key';
  });

  afterAll(() => {
    config.AUTHORIZE_NET_VERIFY_API_LOGIN_ID = ORIGINAL_VERIFY_LOGIN_ID;
    config.AUTHORIZE_NET_VERIFY_TRANSACTION_KEY = ORIGINAL_VERIFY_KEY;
  });

  beforeEach(async () => {
    await ctx.knex('hotels').where({ id: hotelId }).update({
      payment_provider: PaymentProvider.RESNEXUS,
      telegram_alerts_group_id: '-100123',
      updated_at: new Date(),
    });

    pmsStub = new StubPmsReservationService();
    sendSms = jest.fn().mockResolvedValue('sms_test_sid');
    sendTelegram = jest.fn().mockResolvedValue(1);
    ({ service, paymentBundle } = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: {
        pmsReservationService: pmsStub,
        smsService: { sendMessage: sendSms } as never,
        telegramNotificationService: { sendMessage: sendTelegram } as never,
      },
    }));
  });

  // The confirmations are sent in the background after the response.
  async function sentMessage(send: jest.Mock): Promise<string> {
    for (let i = 0; i < 100 && send.mock.calls.length === 0; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(send).toHaveBeenCalledTimes(1);
    return send.mock.calls[0][0].content.message;
  }

  function createReservation() {
    return createResNexusCardBooking(service, ctx.knex);
  }

  // A second room on the same booking, shaped like the one creation made.
  async function addRoom(bookingId: string, suffix: string) {
    const firstRoom = await ctx
      .knex('reservations')
      .where({ booking_id: bookingId })
      .first();
    const roomId = randomUUID();
    await ctx.knex('reservations').insert({
      ...firstRoom,
      booking_id: `${bookingId}${suffix}`,
      id: roomId,
    });
    const quote = await ctx
      .knex('quotes')
      .where({ reservation_id: firstRoom.id })
      .first();
    await ctx
      .knex('quotes')
      .insert({ ...quote, id: randomUUID(), reservation_id: roomId });
  }

  async function reservationsFor(bookingId: string) {
    return ctx
      .knex('reservations')
      .where('booking_id', 'like', `${bookingId}%`)
      .orderBy('booking_id');
  }

  function cardFor(reviewId: string): ResNexusCardRequest {
    return {
      reservation_review_id: reviewId,
      pan: PAN,
      cvv: CVV,
      expiryDate: '3012',
      card_holder_name: 'Ada Lovelace',
    };
  }

  it('creates the booking as externally managed, with no payments row', async () => {
    const { created } = await createReservation();

    expect(created.payment_status).toBe(
      ReservationPaymentStatus.EXTERNALLY_MANAGED,
    );
    expect(created.payments).toEqual([]);
    expect(await ctx.knex('payments').count({ n: '*' })).toEqual([{ n: 0 }]);
    expect(await ctx.knex('payment_reservations')).toHaveLength(0);
  });

  it('hands the card to the PMS create call and confirms the booking', async () => {
    const { created, reviewId } = await createReservation();

    const result = await service.processResNexusCardAndCreateReservations(
      cardFor(reviewId),
    );

    expect(result).toEqual({
      success: true,
      resnexus_reservation_ids: ['EXT-TEST-1'],
    });

    expect(pmsStub.createReservation).toHaveBeenCalledTimes(1);
    expect(pmsStub.createReservation.mock.calls[0][0].card).toEqual({
      pan: PAN,
      cvv: CVV,
      expiryMonth: 12,
      expiryYear: 2030,
      cardHolderName: 'Ada Lovelace',
    });

    const [reservationAfter] = await reservationsFor(created.booking_id);
    expect(reservationAfter.status).toBe(ReservationStatus.ACTIVE);
    expect(reservationAfter.external_id).toBe('EXT-TEST-1');
    expect(reservationAfter.payment_status).toBe(
      ReservationPaymentStatus.EXTERNALLY_MANAGED,
    );
    expect(await ctx.knex('payments')).toHaveLength(0);

    expect(paymentBundle.stripeService.createInvoice).not.toHaveBeenCalled();
  });

  it('books every room of a multi-room booking with the same card', async () => {
    const { created, reviewId } = await createReservation();
    await addRoom(created.booking_id, '_2');
    pmsStub.createReservation
      .mockResolvedValueOnce({ reservation_id: 'EXT-ROOM-1' })
      .mockResolvedValueOnce({ reservation_id: 'EXT-ROOM-2' });

    const result = await service.processResNexusCardAndCreateReservations(
      cardFor(reviewId),
    );

    expect(result).toEqual({
      success: true,
      resnexus_reservation_ids: ['EXT-ROOM-1', 'EXT-ROOM-2'],
    });
    expect(pmsStub.createReservation).toHaveBeenCalledTimes(2);
    for (const [params] of pmsStub.createReservation.mock.calls) {
      expect(params.card?.pan).toBe(PAN);
    }
    // Availability is checked for every room before the first one is charged.
    expect(pmsStub.validateRoomAvailability).toHaveBeenCalledTimes(1);
    expect(pmsStub.validateRoomAvailability.mock.calls[0][0]).toHaveLength(2);

    const rooms = await reservationsFor(created.booking_id);
    expect(rooms.map((r) => r.status)).toEqual([
      ReservationStatus.ACTIVE,
      ReservationStatus.ACTIVE,
    ]);
  });

  it('keeps the rooms already booked when a later room fails, and reports the rest', async () => {
    const { created, reviewId } = await createReservation();
    await addRoom(created.booking_id, '_2');
    pmsStub.createReservation
      .mockResolvedValueOnce({ reservation_id: 'EXT-ROOM-1' })
      .mockRejectedValueOnce(
        new Error('The requested itinerary is not available'),
      );

    const result = await service.processResNexusCardAndCreateReservations(
      cardFor(reviewId),
    );

    expect(result).toEqual({
      success: true,
      resnexus_reservation_ids: ['EXT-ROOM-1'],
      failed_booking_ids: [`${created.booking_id}_2`.toUpperCase()],
    });
    expect(pmsStub.cancelReservation).not.toHaveBeenCalled();
    expect(
      (logKpi as jest.Mock).mock.calls.filter(
        ([event]) =>
          event.stat === KpiStat.PmsBookingCardSent &&
          event.contextId === created.booking_id,
      ),
    ).toHaveLength(2);

    const rooms = await reservationsFor(created.booking_id);
    expect(rooms.map((r) => r.status)).toEqual([
      ReservationStatus.ACTIVE,
      ReservationStatus.INACTIVE,
    ]);
  });

  it('tells the guest and the hotel which rooms were not booked', async () => {
    const { created, reviewId } = await createReservation();
    await addRoom(created.booking_id, '_2');
    pmsStub.createReservation
      .mockResolvedValueOnce({ reservation_id: 'EXT-ROOM-1' })
      .mockRejectedValueOnce(
        new Error('The requested itinerary is not available'),
      );

    await service.processResNexusCardAndCreateReservations(cardFor(reviewId));

    const sms = await sentMessage(sendSms);
    expect(sms).toContain('only partly confirmed');
    expect(sms).toContain('1 of your 2 rooms could not be booked');
    expect(sms).not.toContain("You're all set");

    const telegram = await sentMessage(sendTelegram);
    expect(telegram).toContain('Booking Partly Confirmed');
    expect(telegram).toContain(
      `Not booked:</b> ${`${created.booking_id}_2`.toUpperCase()}`,
    );
  });

  it('sends the usual confirmation when every room is booked', async () => {
    const { reviewId } = await createReservation();
    pmsStub.createReservation.mockResolvedValueOnce({
      reservation_id: 'EXT-ROOM-1',
    });

    await service.processResNexusCardAndCreateReservations(cardFor(reviewId));

    expect(await sentMessage(sendSms)).toContain("You're all set");
    const telegram = await sentMessage(sendTelegram);
    expect(telegram).toContain('✅ Booking Confirmed');
    expect(telegram).not.toContain('Not booked');
  });

  it('lets a request whose claim went stale release only its own claim', async () => {
    const { created } = await createReservation();
    const [room] = await reservationsFor(created.booking_id);
    const repository = service['reservationRepository'];

    // Backdated rather than claimed now, so the two claims never share a millisecond.
    const staleClaim = dayjs().subtract(1, 'hour').toDate();
    await ctx
      .knex('reservations')
      .where({ id: room.id })
      .update({ pms_booking_claimed_at: staleClaim });
    // A later caller takes the room over once the first claim counts as stale.
    const takeover = await repository.claimForPmsBooking(
      [room.id],
      dayjs().subtract(1, 'minute').toDate(),
    );
    expect(takeover).not.toBeNull();

    await repository.releasePmsBookingClaim([room.id], staleClaim);
    const [held] = await reservationsFor(created.booking_id);
    expect(held.pms_booking_claimed_at).not.toBeNull();

    await repository.releasePmsBookingClaim([room.id], takeover!);
    const [released] = await reservationsFor(created.booking_id);
    expect(released.pms_booking_claimed_at).toBeNull();
  });

  it('books only the rooms still pending on a retry', async () => {
    const { created, reviewId } = await createReservation();
    await addRoom(created.booking_id, '_2');
    pmsStub.createReservation
      .mockResolvedValueOnce({ reservation_id: 'EXT-ROOM-1' })
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockResolvedValueOnce({ reservation_id: 'EXT-ROOM-2' });

    await service.processResNexusCardAndCreateReservations(cardFor(reviewId));
    const retry = await service.processResNexusCardAndCreateReservations(
      cardFor(reviewId),
    );

    expect(retry).toEqual({
      success: true,
      resnexus_reservation_ids: ['EXT-ROOM-2'],
    });
    expect(pmsStub.createReservation).toHaveBeenCalledTimes(3);
  });

  it('refuses a second submission while the first is still booking', async () => {
    const { reviewId } = await createReservation();
    let finishFirst!: (value: { reservation_id: string }) => void;
    pmsStub.createReservation.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
    );

    const first = service.processResNexusCardAndCreateReservations(
      cardFor(reviewId),
    );
    await new Promise((resolve) => setImmediate(resolve));
    while (pmsStub.createReservation.mock.calls.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    await expect(
      service.processResNexusCardAndCreateReservations(cardFor(reviewId)),
    ).rejects.toThrow(/is already being confirmed/);

    finishFirst({ reservation_id: 'EXT-TEST-1' });
    await expect(first).resolves.toMatchObject({ success: true });
    expect(pmsStub.createReservation).toHaveBeenCalledTimes(1);
  });

  it('books a room whose claim was left behind by a crashed request', async () => {
    const { created, reviewId } = await createReservation();
    await ctx
      .knex('reservations')
      .where({ booking_id: created.booking_id })
      .update({
        pms_booking_claimed_at: dayjs().subtract(1, 'hour').toDate(),
      });

    await expect(
      service.processResNexusCardAndCreateReservations(cardFor(reviewId)),
    ).resolves.toMatchObject({ success: true });
  });

  it('refuses a booking that is already confirmed', async () => {
    const { reviewId } = await createReservation();
    await service.processResNexusCardAndCreateReservations(cardFor(reviewId));

    await expect(
      service.processResNexusCardAndCreateReservations(cardFor(reviewId)),
    ).rejects.toThrow(/is already confirmed/);
    expect(pmsStub.createReservation).toHaveBeenCalledTimes(1);
  });

  it('refuses a card submitted after the link expired, before creating anything', async () => {
    const { created, reviewId } = await createReservation();
    await ctx
      .knex('reservations')
      .where({ booking_id: created.booking_id })
      .update({ status: ReservationStatus.CANCELLED });

    await expect(
      service.processResNexusCardAndCreateReservations(cardFor(reviewId)),
    ).rejects.toThrow('This booking link has expired');

    expect(pmsStub.createReservation).not.toHaveBeenCalled();
  });

  it('refuses a hotel that does not collect through ResNexus', async () => {
    const { reviewId } = await createReservation();
    await ctx
      .knex('hotels')
      .where({ id: hotelId })
      .update({ payment_provider: PaymentProvider.STRIPE });

    await expect(
      service.processResNexusCardAndCreateReservations(cardFor(reviewId)),
    ).rejects.toThrow(/does not collect payment through ResNexus/);

    expect(pmsStub.createReservation).not.toHaveBeenCalled();
  });

  it('refuses a booking created before the hotel moved to ResNexus payments', async () => {
    const { created, reviewId } = await createReservation();
    await ctx
      .knex('reservations')
      .where({ booking_id: created.booking_id })
      .update({ payment_status: ReservationPaymentStatus.PENDING });

    await expect(
      service.processResNexusCardAndCreateReservations(cardFor(reviewId)),
    ).rejects.toThrow(/was not created for ResNexus card payment/);

    expect(pmsStub.createReservation).not.toHaveBeenCalled();
  });

  it('leaves the booking retryable when ResNexus rejects the first room', async () => {
    const { created, reviewId } = await createReservation();
    await addRoom(created.booking_id, '_2');
    pmsStub.createReservation.mockRejectedValueOnce(
      new Error('Request failed due to error(s): card declined'),
    );

    await expect(
      service.processResNexusCardAndCreateReservations(cardFor(reviewId)),
    ).rejects.toThrow(/card declined/);

    // A refused card is not tried against the remaining rooms.
    expect(pmsStub.createReservation).toHaveBeenCalledTimes(1);
    const rooms = await reservationsFor(created.booking_id);
    expect(rooms.map((r) => r.status)).toEqual([
      ReservationStatus.INACTIVE,
      ReservationStatus.INACTIVE,
    ]);
  });

  it('holds a room whose ResNexus outcome is unknown, alerts the hotel and refuses a retry', async () => {
    const { created, reviewId } = await createReservation();
    pmsStub.createReservation.mockRejectedValueOnce(
      new PmsBookingOutcomeUnknownError(),
    );

    const error = await service
      .processResNexusCardAndCreateReservations(cardFor(reviewId))
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ statusCode: 502 });
    expect((error as Error).message).toMatch(/don't submit your card again/);
    const [room] = await reservationsFor(created.booking_id);
    expect(room.status).toBe(ReservationStatus.FAILED);
    expect(pmsStub.cancelReservation).not.toHaveBeenCalled();
    expect(sendTelegram).toHaveBeenCalledTimes(1);

    await expect(
      service.processResNexusCardAndCreateReservations(cardFor(reviewId)),
    ).rejects.toBeInstanceOf(PmsBookingOutcomeUnknownError);
    expect(pmsStub.createReservation).toHaveBeenCalledTimes(1);
  });

  describe('card check before booking', () => {
    let verifyCard: jest.Mock;

    beforeEach(async () => {
      verifyCard = jest.fn().mockResolvedValue('approved');
      ({ service } = createTestRoomReservationService({
        knex: ctx.knex,
        externalStubs: {
          cardVerifier: { verifyCard },
          pmsReservationService: pmsStub,
          smsService: { sendMessage: sendSms } as never,
          telegramNotificationService: { sendMessage: sendTelegram } as never,
        },
      }));
    });

    it('checks the card with the guest and their address, then books', async () => {
      const { reviewId } = await createReservation();

      await service.processResNexusCardAndCreateReservations(cardFor(reviewId));

      expect(verifyCard).toHaveBeenCalledTimes(1);
      const [card, customer] = verifyCard.mock.calls[0];
      expect(card.pan).toBe(PAN);
      expect(customer.address.postal_code).toBe('12345');
      expect(pmsStub.createReservation).toHaveBeenCalledTimes(1);
    });

    it('books without a card check when the Authorize.net credentials are not set', async () => {
      config.AUTHORIZE_NET_VERIFY_TRANSACTION_KEY = '';
      const { reviewId } = await createReservation();

      await service.processResNexusCardAndCreateReservations(cardFor(reviewId));

      expect(verifyCard).not.toHaveBeenCalled();
      expect(pmsStub.createReservation).toHaveBeenCalledTimes(1);
    });

    it('checks the card once for a multi-room booking', async () => {
      const { created, reviewId } = await createReservation();
      await addRoom(created.booking_id, '_2');

      await service.processResNexusCardAndCreateReservations(cardFor(reviewId));

      expect(verifyCard).toHaveBeenCalledTimes(1);
      expect(pmsStub.createReservation).toHaveBeenCalledTimes(2);
    });

    it('books nothing when the card is declined, and lets the guest retry', async () => {
      const { created, reviewId } = await createReservation();
      verifyCard.mockResolvedValueOnce('declined');

      const error = await service
        .processResNexusCardAndCreateReservations(cardFor(reviewId))
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ statusCode: 400 });
      expect((error as Error).message).toMatch(/could not verify this card/);
      expect(pmsStub.createReservation).not.toHaveBeenCalled();
      const [room] = await reservationsFor(created.booking_id);
      expect(room.status).toBe(ReservationStatus.INACTIVE);
      expect(room.pms_booking_claimed_at).toBeNull();

      await service.processResNexusCardAndCreateReservations(cardFor(reviewId));
      expect(pmsStub.createReservation).toHaveBeenCalledTimes(1);
    });

    it('still books in ResNexus when the card check is unavailable', async () => {
      const { created, reviewId } = await createReservation();
      verifyCard.mockResolvedValueOnce('unavailable');

      await service.processResNexusCardAndCreateReservations(cardFor(reviewId));

      expect(pmsStub.createReservation).toHaveBeenCalledTimes(1);
      const [room] = await reservationsFor(created.booking_id);
      expect(room.status).toBe(ReservationStatus.ACTIVE);
    });
  });

  describe('limits on failed card checks', () => {
    const GUEST_PHONE = '+15559876543';
    let verifyCard: jest.Mock;

    beforeEach(async () => {
      failedCardCheckLimiter.reset();

      verifyCard = jest.fn().mockResolvedValue('declined');
      ({ service } = createTestRoomReservationService({
        knex: ctx.knex,
        externalStubs: {
          cardVerifier: { verifyCard },
          pmsReservationService: pmsStub,
          smsService: { sendMessage: sendSms } as never,
          telegramNotificationService: { sendMessage: sendTelegram } as never,
        },
      }));
    });

    afterAll(() => failedCardCheckLimiter.reset());

    function failTenReservations() {
      for (let i = 0; i < 10; i++) {
        failedCardCheckLimiter.recordDecline({
          hotelId,
          phoneNumber: GUEST_PHONE,
          reviewId: `other-review-${i}`,
        });
      }
    }

    it('stops checking cards on a booking after 5 declines', async () => {
      const { reviewId } = await createReservation();

      for (let i = 0; i < 5; i++) {
        await expect(
          service.processResNexusCardAndCreateReservations(cardFor(reviewId)),
        ).rejects.toThrow(/could not verify this card/);
      }
      await expect(
        service.processResNexusCardAndCreateReservations(cardFor(reviewId)),
      ).rejects.toThrow(/couldn't complete this booking/);

      expect(verifyCard).toHaveBeenCalledTimes(5);
      expect(pmsStub.createReservation).not.toHaveBeenCalled();
    });

    it('refuses the card page of a number with 10 failed reservations, without checking the card', async () => {
      const { reviewId } = await createReservation();
      failTenReservations();

      const error = await service
        .processResNexusCardAndCreateReservations(cardFor(reviewId))
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ statusCode: 400 });
      expect((error as Error).message).toBe(
        "We couldn't complete this booking. Please contact the hotel directly.",
      );
      expect((error as Error).message).not.toContain('5559876543');
      expect(verifyCard).not.toHaveBeenCalled();
    });

    it('asks the assistant to escalate a new booking from that number', async () => {
      failTenReservations();

      await expect(createReservation()).rejects.toThrow(
        'This booking could not be completed. Escalate to the hotel.',
      );
      expect(await ctx.knex('reservations')).toHaveLength(0);
    });

    it('does not limit a hotel that is not on ResNexus payments', async () => {
      failTenReservations();
      await ctx.knex('hotels').where({ id: hotelId }).update({
        payment_provider: PaymentProvider.STRIPE,
      });

      await expect(createReservation()).resolves.toBeDefined();
    });
  });
});
