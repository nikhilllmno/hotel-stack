import { randomUUID as uuidv4 } from 'node:crypto';
import config from '../../config';
import {
  IPaymentProviderService,
  PaymentLinkParams,
  PaymentLinkResponse,
} from '../../services/payment/IPaymentProviderService';

/**
 * Opera properties have no hosted payment page: the card is collected by Dextr
 * and tokenized through OPI, so the "payment link" is the Dextr card page. Same
 * arrangement as Mews.
 */
export class OperaPaymentProviderService implements IPaymentProviderService {
  async createPaymentLink(
    params: PaymentLinkParams,
  ): Promise<PaymentLinkResponse> {
    const hotelPath = (params.metadata.hotel_name || 'hotel')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    const linkId = uuidv4();
    return { id: linkId, url: `${config.SECURE_URL}/${hotelPath}/${linkId}` };
  }

  async disablePaymentLink(_paymentLinkId: string): Promise<void> {
    // The link is a Dextr review page URL — nothing to disable externally.
  }
}

export const operaPaymentProviderService = new OperaPaymentProviderService();
export default operaPaymentProviderService;
