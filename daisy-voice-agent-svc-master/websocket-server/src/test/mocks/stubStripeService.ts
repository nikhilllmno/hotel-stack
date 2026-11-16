import type { StripeService } from '../../services/stripe/stripeService';
import { DEFAULT_TEST_PAYMENT_LINK_ID } from './testPaymentLinkDefaults';

export type StubStripeServiceMethods =
  | 'deactivatePaymentResources'
  | 'createPaymentIntent'
  | 'createInvoice'
  | 'createPaymentLink'
  | 'createSetupCheckoutSession'
  | 'getSetupIntent'
  | 'updateCustomerDefaultPaymentMethod';

export interface StubStripeServiceOptions {
  paymentLinkId?: string;
}

export function createStubStripeService(
  options: StubStripeServiceOptions = {},
): jest.Mocked<Pick<StripeService, StubStripeServiceMethods>> {
  const paymentLinkId = options.paymentLinkId ?? DEFAULT_TEST_PAYMENT_LINK_ID;

  return {
    deactivatePaymentResources: jest.fn().mockResolvedValue({
      errors: [],
      linkDisabled: true,
      paymentLinkId,
      priceIds: [],
      productIds: [],
    }),
    createPaymentIntent: jest.fn().mockResolvedValue({ id: 'pi_test' }),
    createInvoice: jest.fn().mockResolvedValue({ id: 'in_test' }),
    createPaymentLink: jest.fn().mockResolvedValue({
      id: paymentLinkId,
      url: `https://checkout.stripe.com/c/pay/${paymentLinkId}`,
    }),
    createSetupCheckoutSession: jest.fn().mockResolvedValue({
      id: 'cs_test_setup_session',
      url: 'https://checkout.stripe.com/c/pay/cs_test_setup_session',
    }),
    getSetupIntent: jest.fn().mockResolvedValue({
      id: 'seti_test',
      payment_method: 'pm_test_card',
      metadata: {},
    }),
    updateCustomerDefaultPaymentMethod: jest.fn().mockResolvedValue({
      id: 'cus_test',
    }),
  };
}
