/**
 * Settles the remaining balance on the auto-charge schedule.
 *
 * The card is already on the reservation from the deposit, so there is no
 * stored token to look up: an auto-charge is just another folio payment against
 * the card Opera holds. That is why nothing card-related is read from the
 * customer record here, unlike the Mews and Shift4 executors.
 */

import { NoDataError } from '../../errors/NoDataError';
import { hotelConfigurationService } from '../../services/hotelConfiguration/hotelConfigurationService';
import {
  AutoChargeExecutionRequest,
  AutoChargeExecutionResult,
  IAutoChargeExecutor,
} from '../../services/payment/autoCharge/IAutoChargeExecutor';
import { PaymentProvider } from '../../types/enums';
import { KpiStat } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import { operaFolioService } from './operaFolioService';

class OperaAutoChargeExecutor implements IAutoChargeExecutor {
  async executeAutoCharge(
    request: AutoChargeExecutionRequest,
  ): Promise<AutoChargeExecutionResult> {
    const { hotel, reservations, amount, paymentId } = request;

    try {
      const reservationId = reservations.find(
        (r) => r.external_id,
      )?.external_id;
      if (!reservationId) {
        throw new NoDataError(
          `No Opera reservation id available to auto-charge booking ${request.bookingIdPrefix}`,
        );
      }

      const authConfig =
        await hotelConfigurationService.getExternalAuthConfigByHotelId(
          hotel.id,
        );

      const postingId = await operaFolioService.postPayment({
        hotelId: hotel.id,
        reservationId,
        amount,
        currency: hotel.currency || 'USD',
        // The card method, not the external one: Opera settles this itself.
        paymentMethodCode: authConfig?.operaCardPaymentMethodCode ?? 'VA',
        postingReference: `Dextr autocharge ${paymentId.slice(0, 8)}`,
        clientId: hotel.assistant_phone_number ?? hotel.id,
        kpi: {
          success: KpiStat.OperaAutochargeSuccess,
          failure: KpiStat.OperaAutochargeFailure,
        },
      });

      logger.info('OperaAutoChargeExecutor: Charge succeeded', {
        booking_id: request.bookingIdPrefix,
        hotel_id: hotel.id,
        opera_posting_id: postingId,
      });

      return {
        success: true,
        provider: PaymentProvider.OPERA,
        ...(postingId && { bookingConfirmationId: postingId }),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error('OperaAutoChargeExecutor: Charge failed', {
        booking_id: request.bookingIdPrefix,
        hotel_id: hotel.id,
        error: errorMessage,
      });
      return {
        success: false,
        provider: PaymentProvider.OPERA,
        error: errorMessage,
      };
    }
  }
}

const operaAutoChargeExecutor = new OperaAutoChargeExecutor();
export default operaAutoChargeExecutor;
