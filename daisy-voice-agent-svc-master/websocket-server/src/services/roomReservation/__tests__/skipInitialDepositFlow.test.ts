import { PaymentStatus } from '@/dtos/enum/PaymentStatus';
import { SessionType } from '@/dtos/enum/SessionType';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { RESERVATION_FLOW_FIXTURE_IDS } from '@/test/fixtures/reservationFlowFixture';
import {
  createTestPaymentService,
  TestPaymentServiceBundle,
} from '@/test/stubs/createTestPaymentService';
import { Country, PaymentProvider } from '@/types/enums';
import dayjs from 'dayjs';

describe('Zero-deposit payment routing (Stripe setup session)', () => {
  const ctx = installPgMemTestContext();
  let bundle: TestPaymentServiceBundle;

  const baseMetadata = () => ({
    check_in: dayjs().add(7, 'day').format('YYYY-MM-DD'),
    check_out: dayjs().add(9, 'day').format('YYYY-MM-DD'),
    num_adults: 2,
    num_children: 0,
    room_count: 1,
    reservation_type: SessionType.CALL,
    hotel_id: RESERVATION_FLOW_FIXTURE_IDS.hotelId,
    customer_phone: '+15559876543',
    hotel_name: 'Test Hotel',
    hotel_phone_number: RESERVATION_FLOW_FIXTURE_IDS.assistantPhoneNumber,
    hotel_sms_number: RESERVATION_FLOW_FIXTURE_IDS.smsNumber,
    hotel_url: 'https://hotel.test.dextr',
    hotel_country: Country.US,
    payment_provider: PaymentProvider.STRIPE,
  });

  beforeEach(() => {
    bundle = createTestPaymentService({ knex: ctx.knex });
  });

  describe('when amount is 0 and provider is Stripe', () => {
    it('calls createSetupCheckoutSession instead of the payment provider createPaymentLink', async () => {
      const { paymentRecord } = await bundle.paymentService.createPayment({
        amount: 0,
        currency: 'usd',
        description: 'Room reservation deposit',
        metadata: baseMetadata(),
        sessionType: SessionType.CALL,
        payment_provider: PaymentProvider.STRIPE,
      });

      expect(
        bundle.stripeService.createSetupCheckoutSession,
      ).toHaveBeenCalledTimes(1);
      expect(
        bundle.paymentProviderService.createPaymentLink,
      ).not.toHaveBeenCalled();

      expect(paymentRecord.payment_link).toContain('checkout.stripe.com');
      expect(paymentRecord.payment_link_id).toBe('cs_test_setup_session');
      expect(paymentRecord.payment_status).toBe(PaymentStatus.PENDING);
      expect(Number(paymentRecord.amount_charged)).toBe(0);
    });

    it('passes currency and metadata to createSetupCheckoutSession', async () => {
      await bundle.paymentService.createPayment({
        amount: 0,
        currency: 'eur',
        description: 'Room reservation deposit',
        metadata: baseMetadata(),
        sessionType: SessionType.CALL,
        payment_provider: PaymentProvider.STRIPE,
      });

      const call =
        bundle.stripeService.createSetupCheckoutSession.mock.calls[0][0];
      expect(call.currency).toBe('eur');
      expect(call.metadata.hotel_id).toBe(RESERVATION_FLOW_FIXTURE_IDS.hotelId);
      expect(call.metadata.payment_id).toBeDefined();
    });
  });

  describe('when amount is greater than 0', () => {
    it('uses the payment provider createPaymentLink for normal deposits', async () => {
      const { paymentRecord } = await bundle.paymentService.createPayment({
        amount: 100,
        currency: 'usd',
        description: 'Room reservation deposit',
        metadata: baseMetadata(),
        sessionType: SessionType.CALL,
        payment_provider: PaymentProvider.STRIPE,
      });

      expect(
        bundle.paymentProviderService.createPaymentLink,
      ).toHaveBeenCalled();
      expect(
        bundle.stripeService.createSetupCheckoutSession,
      ).not.toHaveBeenCalled();

      expect(Number(paymentRecord.amount_charged)).toBe(100);
    });
  });

  describe('non-Stripe providers', () => {
    it('does not call createSetupCheckoutSession for Shift4 even with amount=0', async () => {
      await bundle.paymentService.createPayment({
        amount: 0,
        currency: 'usd',
        description: 'Room reservation deposit',
        metadata: {
          ...baseMetadata(),
          payment_provider: PaymentProvider.SHIFT4,
        },
        sessionType: SessionType.CALL,
        payment_provider: PaymentProvider.SHIFT4,
      });

      expect(
        bundle.paymentProviderService.createPaymentLink,
      ).toHaveBeenCalled();
      expect(
        bundle.stripeService.createSetupCheckoutSession,
      ).not.toHaveBeenCalled();
    });
  });
});
