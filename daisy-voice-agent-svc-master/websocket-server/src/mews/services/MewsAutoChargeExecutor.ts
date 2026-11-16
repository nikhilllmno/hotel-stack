import { Currency } from '../../dtos/enum/Currency';
import { BadRequestError } from '../../errors/BadRequestError';
import {
  AutoChargeExecutionRequest,
  AutoChargeExecutionResult,
  IAutoChargeExecutor,
} from '../../services/payment/autoCharge/IAutoChargeExecutor';
import { PaymentProvider } from '../../types/enums';
import { logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import { getMewsRequestId } from '../utils/mewsErrorUtils';
import mewsPaymentProviderService from './MewsPaymentProviderService';

class MewsAutoChargeExecutor implements IAutoChargeExecutor {
  async executeAutoCharge(
    request: AutoChargeExecutionRequest,
  ): Promise<AutoChargeExecutionResult> {
    const { hotel, reservations, amount } = request;

    // Card token is stored on the customer record at initial-payment time.
    const creditCardId = reservations[0]?.customer?.card_metadata?.token;
    if (!creditCardId) {
      throw new BadRequestError(
        `Customer does not have a stored Mews card token for auto-charge`,
      );
    }

    try {
      const result = await mewsPaymentProviderService.chargeStoredCardForHotel({
        hotelId: hotel.id,
        creditCardId,
        amount,
        // hotel.currency is stored as a display symbol (e.g. "$"); Mews requires
        // an ISO 4217 code, so map it the same way the payment records do.
        currency:
          Currency[hotel.currency as keyof typeof Currency] ?? hotel.currency,
      });

      logger.info('MewsAutoChargeExecutor: Charge succeeded', {
        booking_id: request.bookingIdPrefix,
        hotel_id: hotel.id,
        mews_payment_id: result.paymentId,
      });

      logKpi({
        stat: 'mews_autoCharge_success',
        value: 1,
        contextName: 'MewsAutoChargeExecutor.executeAutoCharge',
        clientId: hotel.id,
        contextId: result.paymentId,
      });

      // Resolve the owning Account id so it can be persisted on the payment;
      // refunds require an AccountId and the charge response omits it. Prefer
      // the id stored on the customer at initial-payment time; only hit Mews
      // for older customers that predate that (no id stored yet).
      let mewsAccountId: string | undefined =
        reservations[0]?.customer?.card_metadata?.mews_account_id;
      if (!mewsAccountId) {
        try {
          mewsAccountId =
            await mewsPaymentProviderService.getAccountIdByCreditCard({
              hotelId: hotel.id,
              creditCardId,
            });
        } catch (lookupError) {
          logger.warn(
            'MewsAutoChargeExecutor: Failed to resolve mews_account_id for auto-charge payment',
            {
              booking_id: request.bookingIdPrefix,
              hotel_id: hotel.id,
              mews_payment_id: result.paymentId,
              error:
                lookupError instanceof Error
                  ? lookupError.message
                  : 'Unknown error',
            },
          );
        }
      }

      return {
        success: true,
        provider: PaymentProvider.MEWS,
        bookingConfirmationId: result.paymentId,
        mewsAccountId,
        mewsCreditCardId: creditCardId,
        raw: result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error('MewsAutoChargeExecutor: Charge failed', {
        booking_id: request.bookingIdPrefix,
        hotel_id: hotel.id,
        error: errorMessage,
        mewsRequestId: getMewsRequestId(error),
      });
      logKpi({
        stat: 'mews_autoCharge_failure',
        value: 1,
        contextName: 'MewsAutoChargeExecutor.executeAutoCharge',
        clientId: hotel.id,
      });
      return {
        success: false,
        provider: PaymentProvider.MEWS,
        error: errorMessage,
      };
    }
  }
}

const mewsAutoChargeExecutor = new MewsAutoChargeExecutor();
export default mewsAutoChargeExecutor;
