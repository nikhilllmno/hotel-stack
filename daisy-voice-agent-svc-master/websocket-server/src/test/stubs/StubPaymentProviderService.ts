import {
  IPaymentProviderService,
  PaymentLinkParams,
  PaymentLinkResponse,
} from '../../services/payment/IPaymentProviderService';
import {
  DEFAULT_TEST_PAYMENT_LINK_ID,
  DEFAULT_TEST_PAYMENT_LINK_URL,
} from '../mocks/testPaymentLinkDefaults';

export interface StubPaymentProviderServiceOptions {
  paymentLinkId?: string;
  paymentLinkUrl?: string;
}

export class StubPaymentProviderService implements IPaymentProviderService {
  createPaymentLink = jest.fn(
    (_params: PaymentLinkParams): Promise<PaymentLinkResponse> =>
      Promise.resolve({
        id: this.paymentLinkId,
        url: this.paymentLinkUrl,
      }),
  );

  disablePaymentLink = jest.fn().mockResolvedValue(undefined);

  private paymentLinkId: string;
  private paymentLinkUrl: string;

  constructor(options: StubPaymentProviderServiceOptions = {}) {
    this.paymentLinkId = options.paymentLinkId ?? DEFAULT_TEST_PAYMENT_LINK_ID;
    this.paymentLinkUrl =
      options.paymentLinkUrl ?? DEFAULT_TEST_PAYMENT_LINK_URL;
  }
}
