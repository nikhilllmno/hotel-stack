/**
 * End to end for the Cloudbeds SDK card route: Dextr creates no payment, books
 * each room in Cloudbeds and attaches the guest's card to it, and every way
 * the submission can be too late or wrong is refused before Cloudbeds is
 * called.
 */
jest.mock('@/cloudbeds/services/CloudbedsSdkPaymentProviderService', () => ({
  __esModule: true,
  default: {
    processCardPayment: jest.fn(),
    chargeReservationBalance: jest.fn(),
  },
}));

import { CloudbedsAPIError } from '@/cloudbeds/errors';
import cloudbedsSdkPaymentProviderService from '@/cloudbeds/services/CloudbedsSdkPaymentProviderService';
import { ReservationPaymentStatus } from '@/dtos/enum/ReservationPaymentStatus';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import { AddressType } from '@/models/Address';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { StubPmsReservationService } from '@/test/stubs/StubPmsReservationService';
import { PaymentProvider, PmsProvider } from '@/types/enums';
import { randomUUID } from 'crypto';
import dayjs from 'dayjs';
import { RoomReservationService } from '../roomReservationService';

const processCardPayment =
  cloudbedsSdkPaymentProviderService.processCardPayment as jest.Mock;
const chargeReservationBalance =
  cloudbedsSdkPaymentProviderService.chargeReservationBalance as jest.Mock;

describe('Cloudbeds SDK card submission flow', () => {
  const ctx = installPgMemTestContext();
  RoomReservationService.cloudbedsStoredCardSettleMs = 0;
  const { hotelId } = RESERVATION_FLOW_FIXTURE_IDS;

  let service: RoomReservationService;
  let pmsStub: StubPmsReservationService;
  let sendTelegram: jest.Mock;

  beforeEach(async () => {
    await ctx.knex('hotels').where({ id: hotelId }).update({
      payment_provider: PaymentProvider.CLOUDBEDS_SDK,
      pms_provider: PmsProvider.CLOUDBEDS,
      telegram_alerts_group_id: '-100123',
      updated_at: new Date(),
    });

    processCardPayment.mockReset().mockResolvedValue({
      cardId: 'card-1',
      storedPaymentMethodId: 'stored-pm-1',
      redirectUrl: null,
    });
    chargeReservationBalance.mockReset().mockResolvedValue({
      status: 'successful',
      amount: 361.49,
      paymentId: 'cb-payment-1',
      redirectUrl: null,
    });
    pmsStub = new StubPmsReservationService();
    sendTelegram = jest.fn().mockResolvedValue(1);
    ({ service } = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: {
        pmsReservationService: pmsStub,
        smsService: {
          sendMessage: jest.fn().mockResolvedValue('sms_test_sid'),
        } as never,
        telegramNotificationService: { sendMessage: sendTelegram } as never,
      },
    }));
  });

  async function createReservation() {
    const created = await service.createSingleRoomReservation(
      {
        check_in: dayjs().add(7, 'day').format('YYYY-MM-DD'),
        check_out: dayjs().add(9, 'day').format('YYYY-MM-DD'),
        customer_email: 'ada@example.com',
        customer_first_name: 'Ada',
        customer_last_name: 'Lovelace',
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

    const reservationRow = await ctx
      .knex('reservations')
      .where({ booking_id: created.booking_id })
      .first();
    await ctx.knex('address').insert({
      address_first_line: '1 Ada Way',
      address_type: AddressType.CONTACT,
      city: 'Schmoton',
      country: 'US',
      created_at: new Date(),
      customer_id: reservationRow.customer_id,
      id: randomUUID(),
      postal_code: '12345',
      state_or_province: 'OH',
      updated_at: new Date(),
    });

    const review = await ctx
      .knex('booking_reviews')
      .where({ booking_id: created.booking_id })
      .first();

    return { created, reviewId: review.reservation_review_id };
  }

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

  function cardFor(reviewId: string) {
    return { reservation_review_id: reviewId, paymentMethodId: 'cbpm_test' };
  }

  async function chargeAtBooking() {
    await ctx
      .knex('hotel_configurations')
      .where({ hotel_id: hotelId })
      .update({ payment_configuration: { charge_at_booking: true } });
  }

  it('creates the booking with no Dextr payment', async () => {
    const { created } = await createReservation();

    expect(created.payment_status).toBe(
      ReservationPaymentStatus.NOT_APPLICABLE,
    );
    expect(await ctx.knex('payments').count({ n: '*' })).toEqual([{ n: 0 }]);
  });

  it('books the room, attaches the card and confirms the booking', async () => {
    const { created, reviewId } = await createReservation();

    const result = await service.processCloudbedsPaymentAndCreateReservations(
      cardFor(reviewId),
    );

    expect(result).toEqual({
      success: true,
      cloudbeds_reservation_ids: ['EXT-TEST-1'],
    });
    expect(processCardPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudbedsReservationId: 'EXT-TEST-1',
        paymentMethodId: 'cbpm_test',
        returnUrl: expect.stringContaining('/booking/success'),
      }),
    );
    const [room] = await reservationsFor(created.booking_id);
    expect(room.status).toBe(ReservationStatus.ACTIVE);
    expect(await ctx.knex('payments').count({ n: '*' })).toEqual([{ n: 0 }]);
  });

  it('attaches the stored card from the first room to the other rooms', async () => {
    const { created, reviewId } = await createReservation();
    await addRoom(created.booking_id, '_2');
    pmsStub.createReservation
      .mockResolvedValueOnce({ reservation_id: 'CB-1' })
      .mockResolvedValueOnce({ reservation_id: 'CB-2' });

    const result = await service.processCloudbedsPaymentAndCreateReservations(
      cardFor(reviewId),
    );

    expect(result.cloudbeds_reservation_ids).toEqual(['CB-1', 'CB-2']);
    expect(
      processCardPayment.mock.calls.map(([p]) => [
        p.cloudbedsReservationId,
        p.paymentMethodId,
      ]),
    ).toEqual([
      ['CB-1', 'cbpm_test'],
      ['CB-2', 'stored-pm-1'],
    ]);
  });

  it('cancels the first room and lets the guest retry when the card is refused', async () => {
    const { created, reviewId } = await createReservation();
    processCardPayment.mockRejectedValueOnce(new Error('card refused'));

    await expect(
      service.processCloudbedsPaymentAndCreateReservations(cardFor(reviewId)),
    ).rejects.toThrow('card refused');

    expect(pmsStub.cancelReservation).toHaveBeenCalledWith(
      expect.objectContaining({ external_id: 'EXT-TEST-1' }),
    );
    const [room] = await reservationsFor(created.booking_id);
    expect(room.status).toBe(ReservationStatus.INACTIVE);

    const retry = await service.processCloudbedsPaymentAndCreateReservations(
      cardFor(reviewId),
    );
    expect(retry.success).toBe(true);
  });

  it('returns the 3DS redirect when Cloudbeds asks for one', async () => {
    const { reviewId } = await createReservation();
    processCardPayment.mockResolvedValueOnce({
      cardId: 'card-1',
      storedPaymentMethodId: null,
      redirectUrl: 'https://3ds.example/challenge',
    });

    const result = await service.processCloudbedsPaymentAndCreateReservations(
      cardFor(reviewId),
    );

    expect(result.redirect_url).toBe('https://3ds.example/challenge');
  });

  it('refuses a booking that is already confirmed', async () => {
    const { reviewId } = await createReservation();
    await service.processCloudbedsPaymentAndCreateReservations(
      cardFor(reviewId),
    );

    await expect(
      service.processCloudbedsPaymentAndCreateReservations(cardFor(reviewId)),
    ).rejects.toThrow('already confirmed');
  });

  it('refuses a second submission while the first is still booking', async () => {
    const { created, reviewId } = await createReservation();
    await ctx
      .knex('reservations')
      .where({ booking_id: created.booking_id })
      .update({ pms_booking_claimed_at: new Date() });

    await expect(
      service.processCloudbedsPaymentAndCreateReservations(cardFor(reviewId)),
    ).rejects.toThrow('already being confirmed');
    expect(pmsStub.createReservation).not.toHaveBeenCalled();
  });

  it('stops booking when another submission takes over the claim', async () => {
    const { created, reviewId } = await createReservation();
    await addRoom(created.booking_id, '_2');
    pmsStub.createReservation.mockImplementationOnce(async () => {
      // A second submission takes over room 2 after this claim went stale.
      await ctx
        .knex('reservations')
        .where({ booking_id: `${created.booking_id}_2` })
        .update({ pms_booking_claimed_at: new Date(Date.now() + 1000) });
      return { reservation_id: 'CB-1' };
    });

    const result = await service.processCloudbedsPaymentAndCreateReservations(
      cardFor(reviewId),
    );

    expect(result.cloudbeds_reservation_ids).toEqual(['CB-1']);
    expect(pmsStub.createReservation).toHaveBeenCalledTimes(1);
  });

  describe('charging at booking (payment_configuration.charge_at_booking)', () => {
    it('leaves the charge to the hotel when the setting is off', async () => {
      const { reviewId } = await createReservation();

      await service.processCloudbedsPaymentAndCreateReservations(
        cardFor(reviewId),
      );

      expect(chargeReservationBalance).not.toHaveBeenCalled();
    });

    it('charges the room balance to the stored card', async () => {
      await chargeAtBooking();
      const { created, reviewId } = await createReservation();

      const result = await service.processCloudbedsPaymentAndCreateReservations(
        cardFor(reviewId),
      );

      expect(result).toEqual({
        success: true,
        cloudbeds_reservation_ids: ['EXT-TEST-1'],
      });
      expect(chargeReservationBalance).toHaveBeenCalledWith({
        hotelId,
        cloudbedsReservationId: 'EXT-TEST-1',
        paymentMethodId: 'cbpm_test',
        description: `Booking ${created.booking_id.toUpperCase()}`,
        returnUrl: expect.stringContaining('/booking/success'),
        // Full payment: the quote's 100, plus rounding room for Cloudbeds' total.
        maxAmount: expect.closeTo(100.05, 5),
      });
      const [room] = await reservationsFor(created.booking_id);
      expect(room.status).toBe(ReservationStatus.ACTIVE);
      await new Promise((resolve) => setImmediate(resolve));
      expect(JSON.stringify(sendTelegram.mock.calls)).toContain(
        'Paid in full at booking through Cloudbeds Payments.',
      );
    });

    it('charges nothing now when the deposit policy asks for nothing at booking', async () => {
      await chargeAtBooking();
      pmsStub.getQuote.mockResolvedValue({
        amountCharged: 0,
        base_rate: 80,
        fees: 10,
        taxes: 10,
        total_amount: 100,
      });
      const { created, reviewId } = await createReservation();

      const result = await service.processCloudbedsPaymentAndCreateReservations(
        cardFor(reviewId),
      );

      expect(result.success).toBe(true);
      expect(chargeReservationBalance).not.toHaveBeenCalled();
      const [room] = await reservationsFor(created.booking_id);
      expect(room.status).toBe(ReservationStatus.ACTIVE);
    });

    it('charges only the deposit the review page showed', async () => {
      await chargeAtBooking();
      pmsStub.getQuote.mockResolvedValue({
        amountCharged: 30,
        base_rate: 80,
        fees: 10,
        taxes: 10,
        total_amount: 100,
      });
      const { reviewId } = await createReservation();

      await service.processCloudbedsPaymentAndCreateReservations(
        cardFor(reviewId),
      );

      expect(chargeReservationBalance).toHaveBeenCalledWith(
        expect.objectContaining({ maxAmount: 30 }),
      );
    });

    it('charges every room of a multi-room booking', async () => {
      await chargeAtBooking();
      const { created, reviewId } = await createReservation();
      await addRoom(created.booking_id, '_2');
      pmsStub.createReservation
        .mockResolvedValueOnce({ reservation_id: 'CB-1' })
        .mockResolvedValueOnce({ reservation_id: 'CB-2' });

      await service.processCloudbedsPaymentAndCreateReservations(
        cardFor(reviewId),
      );

      expect(
        chargeReservationBalance.mock.calls.map(([p]) => [
          p.cloudbedsReservationId,
          p.paymentMethodId,
        ]),
      ).toEqual([
        ['CB-1', 'cbpm_test'],
        ['CB-2', 'cbpm_test'],
      ]);
    });

    it('cancels the booking and lets the guest retry when the charge is declined', async () => {
      await chargeAtBooking();
      const { created, reviewId } = await createReservation();
      const declined = {
        status: 'failed',
        amount: 361.49,
        paymentId: null,
        redirectUrl: null,
      };
      chargeReservationBalance
        .mockResolvedValueOnce(declined)
        .mockResolvedValueOnce(declined);

      await expect(
        service.processCloudbedsPaymentAndCreateReservations(cardFor(reviewId)),
      ).rejects.toThrow('Your card could not be charged');

      expect(pmsStub.cancelReservation).toHaveBeenCalledWith(
        expect.objectContaining({ external_id: 'EXT-TEST-1' }),
      );
      const [room] = await reservationsFor(created.booking_id);
      expect(room.status).toBe(ReservationStatus.INACTIVE);

      const retry = await service.processCloudbedsPaymentAndCreateReservations(
        cardFor(reviewId),
      );
      expect(retry.success).toBe(true);
    });

    it('keeps the booking when a later room is declined after the first was charged', async () => {
      await chargeAtBooking();
      const { created, reviewId } = await createReservation();
      await addRoom(created.booking_id, '_2');
      pmsStub.createReservation
        .mockResolvedValueOnce({ reservation_id: 'CB-1' })
        .mockResolvedValueOnce({ reservation_id: 'CB-2' });
      chargeReservationBalance
        .mockResolvedValueOnce({
          status: 'successful',
          amount: 100,
          paymentId: 'p-1',
          redirectUrl: null,
        })
        .mockResolvedValueOnce({
          status: 'failed',
          amount: 100,
          paymentId: null,
          redirectUrl: null,
        })
        .mockResolvedValueOnce({
          status: 'failed',
          amount: 100,
          paymentId: null,
          redirectUrl: null,
        });

      const result = await service.processCloudbedsPaymentAndCreateReservations(
        cardFor(reviewId),
      );

      expect(result.cloudbeds_reservation_ids).toEqual(['CB-1', 'CB-2']);
      expect(pmsStub.cancelReservation).not.toHaveBeenCalled();
      await new Promise((resolve) => setImmediate(resolve));
      expect(JSON.stringify(sendTelegram.mock.calls)).toContain(
        'Check the payment in Cloudbeds',
      );
    });

    it('keeps the booking and flags the payment when the charge outcome is unknown', async () => {
      await chargeAtBooking();
      const { created, reviewId } = await createReservation();
      chargeReservationBalance.mockRejectedValueOnce(
        new CloudbedsAPIError(
          'Network error connecting to Cloudbeds postCharge',
          500,
        ),
      );

      const result = await service.processCloudbedsPaymentAndCreateReservations(
        cardFor(reviewId),
      );

      expect(result.success).toBe(true);
      expect(chargeReservationBalance).toHaveBeenCalledTimes(1);
      expect(pmsStub.cancelReservation).not.toHaveBeenCalled();
      const [room] = await reservationsFor(created.booking_id);
      expect(room.status).toBe(ReservationStatus.ACTIVE);
      await new Promise((resolve) => setImmediate(resolve));
      expect(JSON.stringify(sendTelegram.mock.calls)).toContain(
        'Check the payment in Cloudbeds',
      );
    });

    it('keeps the booking when room 1 has an unknown outcome and room 2 is refused', async () => {
      await chargeAtBooking();
      const { created, reviewId } = await createReservation();
      await addRoom(created.booking_id, '_2');
      pmsStub.createReservation
        .mockResolvedValueOnce({ reservation_id: 'CB-1' })
        .mockResolvedValueOnce({ reservation_id: 'CB-2' });
      chargeReservationBalance
        .mockRejectedValueOnce(
          new CloudbedsAPIError('Cloudbeds postCharge failed: timeout', 504),
        )
        .mockResolvedValueOnce({
          status: 'failed',
          amount: 100,
          paymentId: null,
          redirectUrl: null,
        });

      const result = await service.processCloudbedsPaymentAndCreateReservations(
        cardFor(reviewId),
      );

      expect(result.cloudbeds_reservation_ids).toEqual(['CB-1', 'CB-2']);
      expect(pmsStub.cancelReservation).not.toHaveBeenCalled();
      await new Promise((resolve) => setImmediate(resolve));
      expect(JSON.stringify(sendTelegram.mock.calls)).toContain(
        'Check the payment in Cloudbeds',
      );
    });

    it('tries the stored card id after Cloudbeds refuses the payment-form id', async () => {
      await chargeAtBooking();
      const { reviewId } = await createReservation();
      chargeReservationBalance.mockRejectedValueOnce(
        new CloudbedsAPIError('Payment method not found', 400),
      );

      const result = await service.processCloudbedsPaymentAndCreateReservations(
        cardFor(reviewId),
      );

      expect(result.success).toBe(true);
      expect(
        chargeReservationBalance.mock.calls.map(([p]) => p.paymentMethodId),
      ).toEqual(['cbpm_test', 'stored-pm-1']);
      expect(pmsStub.cancelReservation).not.toHaveBeenCalled();
    });

    it('cancels the booking when Cloudbeds refuses the charge twice', async () => {
      await chargeAtBooking();
      const { created, reviewId } = await createReservation();
      chargeReservationBalance.mockRejectedValue(
        new CloudbedsAPIError('Card declined', 402),
      );

      await expect(
        service.processCloudbedsPaymentAndCreateReservations(cardFor(reviewId)),
      ).rejects.toThrow('Your card could not be charged');

      expect(chargeReservationBalance).toHaveBeenCalledTimes(2);
      expect(pmsStub.cancelReservation).toHaveBeenCalled();
      const [room] = await reservationsFor(created.booking_id);
      expect(room.status).toBe(ReservationStatus.INACTIVE);
    });

    it('flags the rooms left uncharged when room 1 needs 3DS', async () => {
      await chargeAtBooking();
      const { created, reviewId } = await createReservation();
      await addRoom(created.booking_id, '_2');
      pmsStub.createReservation
        .mockResolvedValueOnce({ reservation_id: 'CB-1' })
        .mockResolvedValueOnce({ reservation_id: 'CB-2' });
      chargeReservationBalance.mockResolvedValueOnce({
        status: 'pending',
        amount: 100,
        paymentId: 'p-1',
        redirectUrl: 'https://3ds.example/charge',
      });

      const result = await service.processCloudbedsPaymentAndCreateReservations(
        cardFor(reviewId),
      );

      expect(result.redirect_url).toBe('https://3ds.example/charge');
      expect(chargeReservationBalance).toHaveBeenCalledTimes(1);
      await new Promise((resolve) => setImmediate(resolve));
      expect(JSON.stringify(sendTelegram.mock.calls)).toContain(
        'Check the payment in Cloudbeds',
      );
    });

    it('sends the guest to the bank page when the charge needs 3DS', async () => {
      await chargeAtBooking();
      const { reviewId } = await createReservation();
      chargeReservationBalance.mockResolvedValueOnce({
        status: 'pending',
        amount: 361.49,
        paymentId: 'cb-payment-1',
        redirectUrl: 'https://3ds.example/charge',
      });

      const result = await service.processCloudbedsPaymentAndCreateReservations(
        cardFor(reviewId),
      );

      expect(result.redirect_url).toBe('https://3ds.example/charge');
    });

    it('does not charge while storing the card still needs 3DS', async () => {
      await chargeAtBooking();
      const { reviewId } = await createReservation();
      processCardPayment.mockResolvedValueOnce({
        cardId: 'card-1',
        storedPaymentMethodId: null,
        redirectUrl: 'https://3ds.example/challenge',
      });

      const result = await service.processCloudbedsPaymentAndCreateReservations(
        cardFor(reviewId),
      );

      expect(result.redirect_url).toBe('https://3ds.example/challenge');
      expect(chargeReservationBalance).not.toHaveBeenCalled();
    });
  });

  describe('the review page after the booking', () => {
    it('checks availability before the booking but not once the room is booked', async () => {
      const { reviewId } = await createReservation();
      pmsStub.validateRoomAvailability.mockClear();

      await service.getReservationDetailsByReviewId(reviewId);
      expect(pmsStub.validateRoomAvailability).toHaveBeenCalledTimes(1);

      await service.processCloudbedsPaymentAndCreateReservations(
        cardFor(reviewId),
      );
      pmsStub.validateRoomAvailability.mockClear();
      pmsStub.validateRoomAvailability.mockRejectedValue(
        new Error(
          'Room type 101 is no longer available for the requested dates',
        ),
      );

      await expect(
        service.getReservationDetailsByReviewId(reviewId),
      ).resolves.toBeDefined();
      expect(pmsStub.validateRoomAvailability).not.toHaveBeenCalled();
    });
  });

  it('refuses a hotel that is not on the Cloudbeds SDK', async () => {
    const { reviewId } = await createReservation();
    await ctx
      .knex('hotels')
      .where({ id: hotelId })
      .update({ payment_provider: PaymentProvider.STRIPE });

    await expect(
      service.processCloudbedsPaymentAndCreateReservations(cardFor(reviewId)),
    ).rejects.toThrow('does not collect cards through the Cloudbeds SDK');
    expect(pmsStub.createReservation).not.toHaveBeenCalled();
  });
});
