jest.mock('@/services/customer/customerService', () => {
  const actual = jest.requireActual('@/services/customer/customerService');
  return {
    __esModule: true,
    ...actual,
    default: { updateCustomer: jest.fn() },
  };
});
jest.mock('@/services/shift4/shift4Service');

import config from '@/config';
import { PaymentStatus } from '@/dtos/enum/PaymentStatus';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import customerService from '@/services/customer/customerService';
import shift4Service from '@/services/shift4/shift4Service';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { StubPmsReservationService } from '@/test/stubs/StubPmsReservationService';
import { PaymentProvider } from '@/types/enums';
import { Shift4CardTokenRequest, Shift4ResponseCode } from '@/types/shift4';
import dayjs from 'dayjs';
import { Knex } from 'knex';
import { RoomReservationService } from '../roomReservationService';

async function seedShift4Hotel(knex: Knex) {
  const now = new Date();
  await knex('hotels')
    .where({ id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
    .update({
      payment_provider: PaymentProvider.SHIFT4,
      updated_at: now,
    });
}

function stubFinalizePmsReservations(service: RoomReservationService) {
  return jest
    .spyOn(service as any, 'finalizePmsReservations')
    .mockImplementation(async (...args: unknown[]) => {
      const reservations = args[0] as Array<{ id: string }>;
      for (const reservation of reservations) {
        // eslint-disable-next-line no-await-in-loop
        await (service as any).reservationRepository.update(reservation.id, {
          status: ReservationStatus.ACTIVE,
        });
      }
      return reservations.map((reservation) => ({
        ...reservation,
        status: ReservationStatus.ACTIVE,
        external_id: 'EXT-TEST-1',
      }));
    });
}

function buildCardTokenData(
  paymentId: string,
  overrides: Partial<Shift4CardTokenRequest> = {},
): Shift4CardTokenRequest {
  return {
    payment_id: paymentId,
    i4go_response: 'ok',
    i4go_responsecode: '00',
    i4go_maskedcard: '411111******1111',
    i4go_uniqueid: 'unique-token-1',
    i4go_expirationmonth: '12',
    i4go_expirationyear: '2030',
    i4go_cardtype: 'VISA',
    i4go_utoken: 'utoken-1',
    ...overrides,
  };
}

function approvedSaleResponse(transactionId = 'txn-approved-1') {
  return {
    result: [
      {
        merchant: { mid: 1, name: 'Test Merchant' },
        server: { name: 'test-server' },
        transaction: {
          authorizationCode: 'AUTH123',
          authSource: 'test',
          hostResponse: {
            reasonCode: '00',
            reasonDescription: 'Approved',
            reattemptPermission: 'N',
          },
          invoice: 'INV123',
          responseCode: Shift4ResponseCode.APPROVED,
          retrievalReference: 'RRN123',
          saleFlag: 'S',
          cardOnFile: { transactionId },
        },
        card: {
          present: 'N',
          token: { value: 'unique-token-1' },
          type: 'VISA',
          number: '411111******1111',
          expirationDate: 1230,
        },
      },
    ],
  } as any;
}

describe('Shift4 zero-deposit card capture', () => {
  const ctx = installPgMemTestContext();

  const checkIn = () => dayjs().add(7, 'day').format('YYYY-MM-DD');
  const checkOut = () => dayjs().add(9, 'day').format('YYYY-MM-DD');
  const sessionId = '77777777-7777-7777-7777-777777777777';

  beforeEach(async () => {
    await seedShift4Hotel(ctx.knex);
    config.HOTEL_SHIFT4_CONFIG = {
      ...config.HOTEL_SHIFT4_CONFIG,
      [RESERVATION_FLOW_FIXTURE_IDS.hotelId]: {
        authToken: 'test-auth-token',
        accessToken: 'test-access-token',
      },
    };
    jest.clearAllMocks();
  });

  async function createReservationAndGetReviewId(
    service: RoomReservationService,
  ) {
    const created = await service.createSingleRoomReservation(
      {
        check_in: checkIn(),
        check_out: checkOut(),
        customer_first_name: 'Jane',
        customer_last_name: 'Doe',
        customer_phone_number: '+15559876543',
        num_adults: 2,
        room_id: 101,
        session_type: SessionType.SMS,
      } as any,
      '+15559876543',
      RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
      sessionId,
      SessionType.SMS,
    );

    const bookingReviewRow = await ctx
      .knex('booking_reviews')
      .where({ booking_id: created.booking_id })
      .first();

    return { created, bookingReviewRow };
  }

  it('captures the card, skips the charge, finalises the booking and notifies the guest when amount_charged is 0', async () => {
    const stubPmsService = new StubPmsReservationService({
      quote: {
        amountCharged: 0,
        base_rate: 100,
        fees: 0,
        taxes: 0,
        total_amount: 100,
      },
    });
    const { service, externalStubs } = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: { pmsReservationService: stubPmsService },
    });
    stubFinalizePmsReservations(service);

    const { created, bookingReviewRow } =
      await createReservationAndGetReviewId(service);

    const paymentRowBefore = await ctx
      .knex('payments')
      .where({ hotel_id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
      .first();
    expect(Number(paymentRowBefore.amount_charged)).toBe(0);
    expect(paymentRowBefore.payment_link_id).toBeTruthy();

    const cardTokenData = buildCardTokenData(
      bookingReviewRow.reservation_review_id,
    );

    const result =
      await service.processShift4InitialDepositAndCreateReservations(
        cardTokenData,
      );

    expect(result).toEqual({ success: true });
    expect(shift4Service.saleTransaction).not.toHaveBeenCalled();

    expect(customerService.updateCustomer).toHaveBeenCalledTimes(1);
    const [, customerUpdatePayload] = (
      customerService.updateCustomer as jest.Mock
    ).mock.calls[0];
    expect(customerUpdatePayload.card_metadata).toEqual({
      token: 'unique-token-1',
      expiration_month: '12',
      expiration_year: '2030',
    });
    expect(customerUpdatePayload.card_metadata.transaction_id).toBeUndefined();

    const paymentRowAfter = await ctx
      .knex('payments')
      .where({ id: paymentRowBefore.id })
      .first();
    expect(paymentRowAfter.payment_status).toBe(PaymentStatus.COMPLETED);
    expect(paymentRowAfter.payment_link_disabled).toBe(true);
    expect(paymentRowAfter.booking_confirmation_id).toBe(
      paymentRowBefore.payment_link_id,
    );

    const reservationRow = await ctx
      .knex('reservations')
      .where({ booking_id: created.booking_id })
      .first();
    expect(reservationRow.status).toBe(ReservationStatus.ACTIVE);
    expect(reservationRow.payment_status).toBeNull();

    await new Promise(process.nextTick);
    expect(
      externalStubs.telegramNotificationService.sendMessage,
    ).toHaveBeenCalledTimes(1);
    expect(externalStubs.smsService.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('collects the deposit via saleTransaction when amount_charged is greater than 0 (regression)', async () => {
    const stubPmsService = new StubPmsReservationService({
      quote: {
        amountCharged: 100,
        base_rate: 80,
        fees: 10,
        taxes: 10,
        total_amount: 100,
      },
    });
    const { service } = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: { pmsReservationService: stubPmsService },
    });
    stubFinalizePmsReservations(service);
    (shift4Service.saleTransaction as jest.Mock).mockResolvedValue(
      approvedSaleResponse(),
    );

    const { bookingReviewRow } = await createReservationAndGetReviewId(service);

    const paymentRowBefore = await ctx
      .knex('payments')
      .where({ hotel_id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
      .first();
    expect(Number(paymentRowBefore.amount_charged)).toBe(100);

    const cardTokenData = buildCardTokenData(
      bookingReviewRow.reservation_review_id,
    );

    const result =
      await service.processShift4InitialDepositAndCreateReservations(
        cardTokenData,
      );

    expect(shift4Service.saleTransaction).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();

    expect(customerService.updateCustomer).toHaveBeenCalledTimes(1);
    const [, customerUpdatePayload] = (
      customerService.updateCustomer as jest.Mock
    ).mock.calls[0];
    expect(customerUpdatePayload.card_metadata.transaction_id).toBe(
      'txn-approved-1',
    );

    const paymentRowAfter = await ctx
      .knex('payments')
      .where({ id: paymentRowBefore.id })
      .first();
    expect(paymentRowAfter.payment_status).toBe(PaymentStatus.COMPLETED);

    const reservationRow = await ctx
      .knex('reservations')
      .where({ hotel_id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
      .first();
    expect(reservationRow.payment_status).not.toBeNull();
  });

  const validThreeDSecure = {
    programProtocol: '1',
    ecommIndicator: '5',
    trxId: 'trx-1',
    directoryServerTranId: 'ds-1',
    cryptogram: 'crypto-1',
    xid: 'xid-1',
  } as unknown as Shift4CardTokenRequest['threeDSecure'];

  async function runNonZeroDepositWith3DS(
    threeDSConfig: { enabled: boolean } | null,
  ) {
    const stubPmsService = new StubPmsReservationService({
      quote: {
        amountCharged: 100,
        base_rate: 80,
        fees: 10,
        taxes: 10,
        total_amount: 100,
      },
    });
    const { service } = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: { pmsReservationService: stubPmsService },
    });
    stubFinalizePmsReservations(service);
    (shift4Service.saleTransaction as jest.Mock).mockResolvedValue(
      approvedSaleResponse(),
    );

    const { bookingReviewRow } = await createReservationAndGetReviewId(service);
    await ctx
      .knex('hotel_configurations')
      .where({ hotel_id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
      .update({
        threeDS_config: threeDSConfig ? JSON.stringify(threeDSConfig) : null,
      });

    const cardTokenData = buildCardTokenData(
      bookingReviewRow.reservation_review_id,
      { threeDSecure: validThreeDSecure },
    );

    await service.processShift4InitialDepositAndCreateReservations(
      cardTokenData,
    );

    const [, customerUpdatePayload] = (
      customerService.updateCustomer as jest.Mock
    ).mock.calls[0];
    const [saleRequest] = (shift4Service.saleTransaction as jest.Mock).mock
      .calls[0];
    return { customerUpdatePayload, saleRequest };
  }

  it('does not store or send 3DS data when the hotel toggle is disabled', async () => {
    const { customerUpdatePayload, saleRequest } =
      await runNonZeroDepositWith3DS(null);

    expect(customerUpdatePayload.card_metadata.threeDSecure).toBeUndefined();
    expect(saleRequest.threeDSecure).toBeUndefined();
  });

  it('sends submitted 3DS data to Shift4 but never persists it when the toggle is enabled', async () => {
    const { customerUpdatePayload, saleRequest } =
      await runNonZeroDepositWith3DS({ enabled: true });

    // 3DS cryptogram is sensitive auth data — sent to Shift4, never stored.
    expect(customerUpdatePayload.card_metadata.threeDSecure).toBeUndefined();
    expect(saleRequest.threeDSecure).toMatchObject({
      trxId: 'trx-1',
      authenticationSource: '2',
    });
  });

  it('rejects with a booking-finalisation error when PMS finalisation fails after the card is captured', async () => {
    const stubPmsService = new StubPmsReservationService({
      quote: {
        amountCharged: 0,
        base_rate: 100,
        fees: 0,
        taxes: 0,
        total_amount: 100,
      },
    });
    const { service } = createTestRoomReservationService({
      knex: ctx.knex,
      externalStubs: { pmsReservationService: stubPmsService },
    });
    jest
      .spyOn(service as any, 'finalizePmsReservations')
      .mockRejectedValue(new Error('PMS unavailable'));

    const { bookingReviewRow } = await createReservationAndGetReviewId(service);

    const paymentRowBefore = await ctx
      .knex('payments')
      .where({ hotel_id: RESERVATION_FLOW_FIXTURE_IDS.hotelId })
      .first();

    const cardTokenData = buildCardTokenData(
      bookingReviewRow.reservation_review_id,
    );

    await expect(
      service.processShift4InitialDepositAndCreateReservations(cardTokenData),
    ).rejects.toThrow(/booking finalisation failed/);

    expect(shift4Service.saleTransaction).not.toHaveBeenCalled();

    const paymentRowAfter = await ctx
      .knex('payments')
      .where({ id: paymentRowBefore.id })
      .first();
    expect(paymentRowAfter.payment_status).toBe(PaymentStatus.COMPLETED);
  });
});
