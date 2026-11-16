import type { Shift4Service } from '../../services/shift4/shift4Service';
import {
  DEFAULT_TEST_PAYMENT_LINK_ID,
  DEFAULT_TEST_PAYMENT_LINK_URL,
} from './testPaymentLinkDefaults';

export interface StubShift4ServiceOptions {
  paymentLinkId?: string;
  paymentLinkUrl?: string;
}

export function createStubShift4Service(
  options: StubShift4ServiceOptions = {},
): jest.Mocked<
  Pick<
    Shift4Service,
    'createPaymentLink' | 'disablePaymentLink' | 'saleTransaction'
  >
> {
  const paymentLinkId = options.paymentLinkId ?? DEFAULT_TEST_PAYMENT_LINK_ID;
  const paymentLinkUrl =
    options.paymentLinkUrl ?? DEFAULT_TEST_PAYMENT_LINK_URL;

  return {
    createPaymentLink: jest.fn().mockResolvedValue({
      id: paymentLinkId,
      url: paymentLinkUrl,
    }),
    disablePaymentLink: jest.fn().mockResolvedValue(undefined),
    saleTransaction: jest.fn(),
  };
}
