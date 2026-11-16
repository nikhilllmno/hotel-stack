import authorizeNetService from '../../authorizeNet/services/authorizeNetService';
import operaPaymentProviderService from '../../calry/services/operaPaymentProviderService';
import cloudbedsSdkPaymentProviderService from '../../cloudbeds/services/CloudbedsSdkPaymentProviderService';
import { BadRequestError } from '../../errors/BadRequestError';
import { NoDataError } from '../../errors/NoDataError';
import mewsPaymentProviderService from '../../mews/services/MewsPaymentProviderService';
import { PaymentProvider } from '../../types/enums';
import logger from '../../utils/logger';
import { HotelService, hotelService } from '../hotel/hotelService';
import shift4Service from '../shift4/shift4Service';
import stripeService from '../stripe/stripeService';
import { IPaymentProviderService } from './IPaymentProviderService';

export class PaymentProviderFactory {
  constructor(private hotelService: HotelService) {}

  private services: Map<PaymentProvider, IPaymentProviderService> = new Map<
    PaymentProvider,
    IPaymentProviderService
  >([
    [PaymentProvider.STRIPE, stripeService as IPaymentProviderService],
    [PaymentProvider.SHIFT4, shift4Service as IPaymentProviderService],
    [PaymentProvider.MEWS, mewsPaymentProviderService],
    [PaymentProvider.CLOUDBEDS_SDK, cloudbedsSdkPaymentProviderService],
    [PaymentProvider.AUTHORIZE_NET, authorizeNetService],
    [PaymentProvider.OPERA, operaPaymentProviderService],
  ]);

  public async getPaymentService(
    hotelId: string,
  ): Promise<IPaymentProviderService> {
    // Get hotel and payment provider info
    const hotel = await this.hotelService.getHotelById(hotelId);
    const paymentProvider = hotel.payment_provider;
    if (!paymentProvider) {
      logger.error(
        `getPaymentService: Hotel ${hotelId} does not have a payment provider configured`,
      );
      throw new NoDataError(
        `Hotel ${hotelId} does not have a payment provider configured`,
      );
    }
    if (paymentProvider === PaymentProvider.NOT_APPLICABLE) {
      throw new BadRequestError(
        `Hotel ${hotelId} does not require payments. Payment operations are not supported.`,
      );
    }
    if (paymentProvider === PaymentProvider.RESNEXUS) {
      throw new BadRequestError(
        `Hotel ${hotelId} is paid directly through ResNexus. Payment operations are not supported.`,
      );
    }
    const service = this.services.get(hotel.payment_provider);

    if (!service) {
      logger.error(
        `Payment provider ${paymentProvider} is not supported. Falling back to Stripe.`,
      );
      throw new BadRequestError(
        `payment provider ${paymentProvider} is not supported`,
      );
    }

    logger.info(`Using payment provider: ${paymentProvider}`);
    return service;
  }
}

const paymentProviderFactory = new PaymentProviderFactory(hotelService);
export default paymentProviderFactory;
