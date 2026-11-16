import { PaymentStatus } from '@/dtos/enum/PaymentStatus';
import { ReservationPaymentStatus } from '@/dtos/enum/ReservationPaymentStatus';
import { ReservationStatus } from '@/dtos/enum/ReservationStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import { ResNexusService } from '@/resNexus/service/reservation/reservationService';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import {
  ageReservationAndPayment,
  RESERVATION_FLOW_FIXTURE_IDS,
} from '@/test/fixtures/reservationFlowFixture';
import {
  defaultStayDates,
  seedReservation,
} from '@/test/fixtures/reservationSeedFixture';
import { TestPaymentServiceBundle } from '@/test/stubs/createTestPaymentService';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';
import { PaymentProvider, PmsProvider } from '@/types/enums';
import { randomUUID } from 'crypto';
import dayjs from 'dayjs';
import { RoomReservationService } from '../roomReservationService';

/**
 * Guards for ResNexus-native payments. Each one keeps a
 * `payment_provider = 'resnexus'` hotel off a Stripe code path it would
 * otherwise fall through to.
 */
const RESNEXUS_AUTO_CHARGE_SKIP = {
  success: true,
  message: 'Auto-charge is handled by ResNexus',
};

describe('ResNexus-native payment guards', () => {
  const ctx = installPgMemTestContext();
  const { hotelId } = RESERVATION_FLOW_FIXTURE_IDS;
  let service: RoomReservationService;
  let paymentBundle: TestPaymentServiceBundle;
  // The default ResNexus stub is a Proxy that mints a fresh jest.fn() on every
  // property read, so a `not.toHaveBeenCalled()` against it always passes. Use
  // a real spy instead.
  let callModifyReservationAPI: jest.Mock;

  beforeEach(async () => {
    await ctx.knex('hotels').where({ id: hotelId }).update({
      payment_provider: PaymentProvider.RESNEXUS,
      pms_provider: PmsProvider.RESNEXUS,
      updated_at: new Date(),
    });

    callModifyReservationAPI = jest.fn().mockResolvedValue(undefined);
    const resNexusStub = new Proxy(
      { callModifyReservationAPI } as Record<string, jest.Mock>,
      {
        get(target, property: string) {
          if (property === 'then') {
            return undefined;
          }
          if (!(property in target)) {
            target[property] = jest.fn().mockResolvedValue(undefined);
          }
          return target[property];
        },
      },
    );
    ({ service, paymentBundle } = createTestRoomReservationService({
      externalStubs: {
        resNexusService: resNexusStub as unknown as ResNexusService,
      },
      knex: ctx.knex,
    }));
  });

  describe('setupAutoCharge', () => {
    it('skips auto-charge and creates no Stripe invoice', async () => {
      const result = await service.setupAutoCharge('BK-ANY', hotelId, {
        is_enabled: true,
      });

      expect(result).toEqual(RESNEXUS_AUTO_CHARGE_SKIP);
      expect(paymentBundle.stripeService.createInvoice).not.toHaveBeenCalled();
    });

    it('still refuses when the hotel takes no payment at all', async () => {
      await ctx
        .knex('hotels')
        .where({ id: hotelId })
        .update({ payment_provider: PaymentProvider.NOT_APPLICABLE });

      await expect(
        service.setupAutoCharge('BK-ANY', hotelId, { is_enabled: true }),
      ).rejects.toThrow(/does not require payment/);
    });
  });

  describe('updateResnexusNotesForPaymentUpdate', () => {
    // A reservation complete enough that the notes push is actually reached:
    // anything missing makes the per-reservation loop bail early, which would
    // make these assertions pass whether or not the guard exists.
    async function buildNotifiableReservation(
      paymentProvider: PaymentProvider,
    ) {
      const seeded = await seedReservation(ctx.knex, {
        ...defaultStayDates(),
        firstName: 'Ada',
        lastName: 'Lovelace',
      });
      const hotel = await ctx.knex('hotels').where({ id: hotelId }).first();

      // The notes body is built from a payment summary, so an unpaid
      // reservation never reaches the ResNexus call.
      const paymentId = randomUUID();
      const now = new Date();
      await ctx.knex('payments').insert({
        amount_charged: 50,
        created_at: now,
        currency: 'USD',
        hotel_id: hotelId,
        id: paymentId,
        payment_provider: paymentProvider,
        payment_status: PaymentStatus.COMPLETED,
        updated_at: now,
      });
      await ctx.knex('payment_reservations').insert({
        created_at: now,
        id: randomUUID(),
        payment_id: paymentId,
        reservation_id: seeded.reservationId,
        updated_at: now,
      });

      return {
        ...seeded,
        booking_id: seeded.bookingId,
        business_id: Number(RESERVATION_FLOW_FIXTURE_IDS.businessId),
        check_in: seeded.checkIn,
        check_out: seeded.checkOut,
        hotel: { ...hotel, payment_provider: paymentProvider },
        hotel_id: hotelId,
        id: seeded.reservationId,
        pms_provider: PmsProvider.RESNEXUS,
        quote: {
          amount_charged: 50,
          base_rate: 90,
          fees: 0,
          quote_object: { raw_response: { base_rate: 90 } },
          taxes: 10,
        },
      } as never;
    }

    it('does not push partner notes when ResNexus owns the ledger', async () => {
      await service.updateResnexusNotesForPaymentUpdate([
        await buildNotifiableReservation(PaymentProvider.RESNEXUS),
      ]);

      expect(callModifyReservationAPI).not.toHaveBeenCalled();
    });

    it('still pushes partner notes for a ResNexus hotel paying via Stripe', async () => {
      await service.updateResnexusNotesForPaymentUpdate([
        await buildNotifiableReservation(PaymentProvider.STRIPE),
      ]);

      expect(callModifyReservationAPI).toHaveBeenCalledTimes(1);
    });
  });
  // The fixture hotel is a ResNexus PMS property, which is what both sides of
  // this comparison have in common. Only who takes the money differs, so each
  // test runs the same step twice and asserts where the two part company.
  //
  // Link creation itself is not compared here: the pg-mem harness replaces the
  // provider factory with a single stub, so both providers mint the same link.
  // That mapping is covered in services/payment/__tests__.
  describe('same ResNexus PMS hotel, Stripe payments vs ResNexus-native', () => {
    async function createReservationUnder(paymentProvider: PaymentProvider) {
      await ctx.knex('hotels').where({ id: hotelId }).update({
        payment_provider: paymentProvider,
        updated_at: new Date(),
      });

      const created = await service.createSingleRoomReservation(
        {
          check_in: dayjs().add(7, 'day').format('YYYY-MM-DD'),
          check_out: dayjs().add(9, 'day').format('YYYY-MM-DD'),
          customer_first_name: 'Ada',
          customer_last_name: 'Lovelace',
          customer_phone_number: '+15559876543',
          num_adults: 2,
          room_id: 101,
          session_type: SessionType.SMS,
        },
        '+15559876543',
        RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
        '77777777-7777-7777-7777-777777777777',
        SessionType.SMS,
      );

      const paymentRow = created.payments[0]
        ? await ctx
            .knex('payments')
            .where({ id: created.payments[0].id })
            .first()
        : undefined;

      return { created, paymentRow };
    }

    async function expire(created: { id: string }, paymentId: string) {
      await ageReservationAndPayment(ctx.knex, created.id, paymentId, 120);
      await service.cancelStaleReservationsAndPayments(60);
      return ctx.knex('payments').where({ id: paymentId }).first();
    }

    // One reservation per test: the harness stub mints a fixed payment_link_id,
    // so a second reservation in the same test collides on it.
    it('expires the Stripe link by calling Stripe', async () => {
      const { created, paymentRow } = await createReservationUnder(
        PaymentProvider.STRIPE,
      );
      const expired = await expire(created, paymentRow.id);

      expect(
        paymentBundle.stripeService.deactivatePaymentResources,
      ).toHaveBeenCalledTimes(1);
      expect(expired.payment_link_disabled).toBe(true);
      expect(expired.payment_status).toBe(PaymentStatus.CANCELLED);
    });

    it('creates no payment or link for the ResNexus-native hotel, and expires it without Stripe', async () => {
      const { created, paymentRow } = await createReservationUnder(
        PaymentProvider.RESNEXUS,
      );

      expect(paymentRow).toBeUndefined();
      expect(created.payment_status).toBe(
        ReservationPaymentStatus.EXTERNALLY_MANAGED,
      );

      await ctx
        .knex('reservations')
        .where({ id: created.id })
        .update({ created_at: dayjs().subtract(2, 'hour').toDate() });
      await service.cancelStaleReservationsAndPayments(60);
      await service.cancelStaleNoPaymentReservations(60);

      const reservation = await ctx
        .knex('reservations')
        .where({ id: created.id })
        .first();
      expect(reservation.status).toBe(ReservationStatus.CANCELLED);
      expect(
        paymentBundle.stripeService.deactivatePaymentResources,
      ).not.toHaveBeenCalled();
    });

    it('does not expire a booking while its card submission is booking it', async () => {
      const { created } = await createReservationUnder(
        PaymentProvider.RESNEXUS,
      );
      await ctx
        .knex('reservations')
        .where({ id: created.id })
        .update({
          created_at: dayjs().subtract(2, 'hour').toDate(),
          pms_booking_claimed_at: new Date(),
        });

      await service.cancelStaleReservationsAndPayments(60);
      await service.cancelStaleNoPaymentReservations(60);

      const reservation = await ctx
        .knex('reservations')
        .where({ id: created.id })
        .first();
      expect(reservation.status).toBe(ReservationStatus.INACTIVE);
    });

    it('does not expire a booking whose card submission starts after the stale query', async () => {
      const { created } = await createReservationUnder(
        PaymentProvider.RESNEXUS,
      );
      await ctx
        .knex('reservations')
        .where({ id: created.id })
        .update({ created_at: dayjs().subtract(2, 'hour').toDate() });

      const repository = service['reservationRepository'];
      const findStale = repository.findStaleReservations.bind(repository);
      jest
        .spyOn(repository, 'findStaleReservations')
        .mockImplementationOnce(async (...args) => {
          const stale = await findStale(...args);
          await repository.claimForPmsBooking(
            [created.id],
            dayjs().subtract(5, 'minute').toDate(),
          );
          return stale;
        });

      await service.cancelStaleReservationsAndPayments(60);

      const reservation = await ctx
        .knex('reservations')
        .where({ id: created.id })
        .first();
      expect(reservation.status).toBe(ReservationStatus.INACTIVE);
      expect(reservation.pms_booking_claimed_at).not.toBeNull();
    });

    it('keeps Dextr auto-charge for the Stripe hotel', async () => {
      const { created } = await createReservationUnder(PaymentProvider.STRIPE);
      // The Stripe invoice path runs on the app's own db connection, which
      // pg-mem does not back, so only the routing decision is asserted here.
      const stripeAutoCharge = jest
        .spyOn(service as any, 'setupAutoChargeStripe')
        .mockResolvedValue({ success: true, message: 'Auto-charge scheduled' });

      const result = await service.setupAutoCharge(
        created.booking_id,
        hotelId,
        { is_enabled: true },
      );

      expect(result).not.toEqual(RESNEXUS_AUTO_CHARGE_SKIP);
      expect(stripeAutoCharge).toHaveBeenCalledWith(
        created.booking_id,
        hotelId,
        { is_enabled: true },
        undefined,
      );
    });

    it('hands auto-charge to ResNexus for the native hotel', async () => {
      const { created } = await createReservationUnder(
        PaymentProvider.RESNEXUS,
      );

      await expect(
        service.setupAutoCharge(created.booking_id, hotelId, {
          is_enabled: true,
        }),
      ).resolves.toEqual(RESNEXUS_AUTO_CHARGE_SKIP);
      expect(paymentBundle.stripeService.createInvoice).not.toHaveBeenCalled();
    });
  });
});
