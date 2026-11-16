import { PaymentMetadata } from '../../types/payment';

export interface PaymentLinkParams {
  amount: number;
  currency: string;
  description: string;
  metadata: PaymentMetadata;
  connectedAccountId?: string;
}

export interface PaymentLinkResponse {
  id: string;
  url: string;
}

export interface IPaymentProviderService {
  createPaymentLink(params: PaymentLinkParams): Promise<PaymentLinkResponse>;
  disablePaymentLink(
    paymentLinkId: string,
    connectedAccountID?: string,
  ): Promise<any>;
}
