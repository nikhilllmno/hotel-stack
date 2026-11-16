import { BadRequestError } from '../../errors/BadRequestError';
import customerService from '../../services/customer/customerService';
import {
  AutoChargeExecutionRequest,
  AutoChargeExecutionResult,
  IAutoChargeExecutor,
} from '../../services/payment/autoCharge/IAutoChargeExecutor';
import { PaymentProvider } from '../../types/enums';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import { authorizeNetTokenService } from './AuthorizeNetTokenService';
import authorizeNetService, {
  CofFieldsProfileCharge,
} from './authorizeNetService';

class AuthorizeNetAutoChargeExecutor implements IAutoChargeExecutor {
  async executeAutoCharge(
    request: AutoChargeExecutionRequest,
  ): Promise<AutoChargeExecutionResult> {
    const { bookingIdPrefix, hotel, reservations, amount } = request;

    const customer = reservations[0]?.customer;
    if (!customer?.id) {
      throw new BadRequestError(
        `Customer not found for auto-charge on booking ${bookingIdPrefix}`,
      );
    }

    const cardMetadata = customer.card_metadata;
    if (
      !cardMetadata?.authnet_customer_profile_id ||
      !cardMetadata?.authnet_payment_profile_id
    ) {
      throw new BadRequestError(
        `Customer ${customer.id} does not have stored Authorize.Net profile IDs for auto-charge`,
      );
    }

    const accessToken = await authorizeNetTokenService.getAccessTokenForHotel(
      hotel.id,
    );

    // Non-zero deposit bookings have a networkTransId from the initial charge;
    // zero-deposit bookings won't — valid MIT without a reference.
    const cofFields: CofFieldsProfileCharge = {};
    if (cardMetadata.authnet_network_trans_id) {
      cofFields.originalNetworkTransId = cardMetadata.authnet_network_trans_id;
      cofFields.originalAuthAmount = cardMetadata.authnet_original_auth_amount;
    }

    try {
      const chargeResult = await authorizeNetService.chargeWithProfile(
        accessToken,
        amount,
        {
          customerProfileId: cardMetadata.authnet_customer_profile_id,
          paymentProfileId: cardMetadata.authnet_payment_profile_id,
        },
        cofFields,
      );

      logger.info('AuthorizeNetAutoChargeExecutor: Charge succeeded', {
        booking_id: bookingIdPrefix,
        hotel_id: hotel.id,
        transactionId: chargeResult.transactionId,
      });

      logKpi({
        stat: KpiStat.PaymentAutochargeSucceeded,
        value: 1,
        contextName: 'AuthorizeNetAutoChargeExecutor.executeAutoCharge',
        clientId: hotel.assistant_phone_number ?? hotel.id,
      });

      // Zero-deposit: first real charge — persist networkTransId for future MIT chain
      if (
        !cardMetadata.authnet_network_trans_id &&
        chargeResult.networkTransId
      ) {
        try {
          await customerService.updateCustomer(customer.id, {
            card_metadata: {
              ...cardMetadata,
              authnet_network_trans_id: chargeResult.networkTransId,
              authnet_original_auth_amount: amount,
            },
          });
          logger.info(
            `AuthorizeNetAutoChargeExecutor: Stored networkTransId for customer ${customer.id}`,
          );
        } catch (updateError) {
          logger.error(
            `AuthorizeNetAutoChargeExecutor: CRITICAL - Charge succeeded but failed to store networkTransId for customer ${customer.id}. Manual intervention required.`,
            updateError,
          );
        }
      }

      return {
        success: true,
        provider: PaymentProvider.AUTHORIZE_NET,
        bookingConfirmationId: chargeResult.transactionId,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error('AuthorizeNetAutoChargeExecutor: Charge failed', {
        booking_id: bookingIdPrefix,
        hotel_id: hotel.id,
        error: errorMessage,
      });
      logKpi({
        stat: KpiStat.PaymentAutochargeFailed,
        value: 1,
        contextName: 'AuthorizeNetAutoChargeExecutor.executeAutoCharge',
        clientId: hotel.assistant_phone_number ?? hotel.id,
      });
      return {
        success: false,
        provider: PaymentProvider.AUTHORIZE_NET,
        error: errorMessage,
      };
    }
  }
}

const authorizeNetAutoChargeExecutor = new AuthorizeNetAutoChargeExecutor();
export default authorizeNetAutoChargeExecutor;
