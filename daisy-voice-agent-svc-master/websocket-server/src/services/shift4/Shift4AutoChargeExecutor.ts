import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import config from '../../config';
import { Hotel } from '../../dtos/Hotel';
import { HotelConfiguration } from '../../dtos/HotelConfiguration';
import { Reservation as ReservationDTO } from '../../dtos/Reservation';
import { BadRequestError } from '../../errors/BadRequestError';
import { NoDataError } from '../../errors/NoDataError';
import { PaymentProvider } from '../../types/enums';
import {
  AdditionalChargeValue,
  CardOnFileType,
  CardPresent,
  HotelPrimaryChargeType,
  HotelSpecialCode,
  Shift4ResponseCode,
  Shift4SaleTransactionRequest,
  Shift4SaleTransactionResult,
  TransactionAuthorizationRequestOptions,
} from '../../types/shift4';
import { roundCurrency } from '../../utils/helper';
import logger from '../../utils/logger';
import customerService from '../customer/customerService';
import {
  AutoChargeExecutionRequest,
  AutoChargeExecutionResult,
  IAutoChargeExecutor,
} from '../payment/autoCharge/IAutoChargeExecutor';
import { logPaymentContext } from '../payment/logPaymentContext';
import paymentService from '../payment/paymentService';
import shift4Service from './shift4Service';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface Shift4DelayedChargeResult {
  result: Shift4SaleTransactionResult | undefined;
  success: boolean;
  responseCode: Shift4ResponseCode | undefined;
  responseData: Shift4SaleTransactionResult | undefined;
  invoiceId: string;
}

/**
 * Builds and executes a Shift4 DELAYED_CHARGE sale transaction against a stored card.
 * Shared by the scheduled auto-charge job (Shift4AutoChargeExecutor) and the admin
 * manual-charge flow (RoomReservationService.chargeReservationImmediatelyShift4).
 */
export async function shift4DelayedCharge(params: {
  bookingId: string;
  hotel: Hotel;
  hotelConfig: HotelConfiguration | null;
  reservations: ReservationDTO[];
  chargeAmount: number;
  invoiceId: string;
  isManualCharge?: boolean;
}): Promise<Shift4DelayedChargeResult> {
  const {
    bookingId,
    hotel,
    hotelConfig,
    reservations,
    chargeAmount,
    invoiceId,
    isManualCharge = false,
  } = params;

  try {
    logger.info('shift4DelayedCharge: Processing delayed charge', {
      booking_id: bookingId,
      hotel_id: hotel.id,
      amount: chargeAmount,
    });

    if (!reservations.length) {
      throw new NoDataError(
        `No reservations found for booking ID ${bookingId}`,
      );
    }

    const hotelShift4Config = config.HOTEL_SHIFT4_CONFIG[hotel.id];
    if (!hotelShift4Config) {
      throw new BadRequestError(
        `Shift4 payment configuration not found for hotel ${hotel.id}`,
      );
    }

    const primaryReservation = reservations[0];
    const customer = primaryReservation.customer;
    if (!customer || !customer.id) {
      throw new NoDataError(
        `Customer not found for reservation ${primaryReservation.id}`,
      );
    }

    const cardMetadata = customer.card_metadata;
    if (
      !cardMetadata ||
      !cardMetadata.token ||
      !cardMetadata.expiration_month ||
      !cardMetadata.expiration_year
    ) {
      throw new BadRequestError(
        `Customer ${customer.id} does not have stored card metadata for delayed charge`,
      );
    }

    // No prior transaction_id (e.g. zero-deposit booking whose card was
    // captured but never charged) means this is the first charge on the
    // card, so it must use the cardholder-initiated U01 type rather than
    // the merchant-initiated U02 type used for subsequent charges.
    const cardOnFile = cardMetadata.transaction_id
      ? { type: CardOnFileType.U02, transactionId: cardMetadata.transaction_id }
      : { type: CardOnFileType.U01 };

    const hotelTimezone = hotel.timezone;
    const checkInCheckOutTimes = hotelConfig?.check_in_check_out_configuration;
    const checkInTime = checkInCheckOutTimes?.check_in || '15:00';
    const checkOutTime = checkInCheckOutTimes?.check_out || '11:00';

    const arrivalDateTime = dayjs
      .tz(primaryReservation.check_in, hotelTimezone)
      .hour(parseInt(checkInTime.split(':')[0]))
      .minute(parseInt(checkInTime.split(':')[1]))
      .format('YYYY-MM-DDTHH:mm:ss.SSSZ');

    const departureDateTime = dayjs
      .tz(primaryReservation.check_out, hotelTimezone)
      .hour(parseInt(checkOutTime.split(':')[0]))
      .minute(parseInt(checkOutTime.split(':')[1]))
      .format('YYYY-MM-DDTHH:mm:ss.SSSZ');

    const roomRates = reservations.map((res) => {
      const checkInDate = dayjs(res.check_in);
      const checkOutDate = dayjs(res.check_out);
      const nights = checkOutDate.diff(checkInDate, 'day');
      const reservationAmount = res.quote?.total_amount || 0;
      const perNightRate = reservationAmount / nights;

      return {
        nights,
        rate: roundCurrency(perNightRate),
      };
    });

    let totalTax: number;
    let productDescriptors: string[];

    if (isManualCharge) {
      totalTax = 0;
      productDescriptors = ['Room Reservation - Manual Charge'];
    } else {
      totalTax = reservations.reduce((sum, res) => {
        return sum + (res.quote?.taxes || 0);
      }, 0);
      productDescriptors = ['Room Reservation - Remaining Balance'];
    }

    const saleTransactionRequest: Shift4SaleTransactionRequest = {
      dateTime: dayjs().tz(hotelTimezone).format('YYYY-MM-DDTHH:mm:ss.SSSZ'),
      apiOptions: [TransactionAuthorizationRequestOptions.RETURNEXPDATE],
      amount: {
        total: chargeAmount,
        tax: totalTax,
      },
      clerk: {
        numericId: 1,
      },
      customer: {
        addressLine1: customer.address?.address_first_line?.substring(0, 30),
        firstName: customer.first_name?.substring(0, 30),
        lastName: customer.last_name?.substring(0, 30),
        postalCode: customer.address?.postal_code
          ?.replace(/[^a-zA-Z0-9]/g, '')
          .substring(0, 9),
        emailAddress: customer.email?.substring(0, 80),
        ipAddress: customer.address?.ip_address,
      },
      transaction: {
        invoice: invoiceId,
        purchaseCard: {
          customerReference: invoiceId,
          destinationPostalCode: customer.address?.postal_code!,
          productDescriptors: productDescriptors,
        },
        cardOnFile,
        hotel: {
          arrivalDateTime,
          departureDateTime,
          primaryChargeType: HotelPrimaryChargeType.LODGING,
          roomRates,
          specialCode: HotelSpecialCode.DELAYED_CHARGE,
          additionalCharges: {
            other: AdditionalChargeValue.YES,
          },
        },
      },
      card: {
        present: CardPresent.NO,
        token: {
          value: cardMetadata.token,
        },
        expirationDate: parseInt(
          `${cardMetadata.expiration_month}${cardMetadata.expiration_year.slice(-2)}`,
        ),
      },
    };

    logPaymentContext({
      invoiceId,
      hotel,
      bookingId,
      customer,
    });

    const saleResponse = await shift4Service.saleTransaction(
      saleTransactionRequest,
      hotelShift4Config.accessToken,
    );

    const saleResponseData = saleResponse.result?.[0];

    logger.info('shift4DelayedCharge: Sale transaction completed', {
      booking_id: bookingId,
      invoice: invoiceId,
      response_code: saleResponseData?.transaction?.responseCode,
    });

    const success = [
      Shift4ResponseCode.APPROVED,
      Shift4ResponseCode.APPROVED_CEILING,
    ].includes(
      saleResponseData?.transaction?.responseCode as Shift4ResponseCode,
    );

    // First charge on this card (no prior transaction_id): persist the
    // transactionId the sale response returns so future charges can use
    // the merchant-initiated U02 type instead of U01. The charge already
    // succeeded at the gateway, so a failure here must not propagate and
    // fail the charge itself — that would make the scheduler retry and
    // double-charge the guest.
    if (success && !cardMetadata.transaction_id) {
      const newTransactionId =
        saleResponseData?.transaction?.cardOnFile?.transactionId;
      if (newTransactionId) {
        try {
          await customerService.updateCustomer(customer.id, {
            card_metadata: {
              ...cardMetadata,
              transaction_id: newTransactionId,
            },
          });
          logger.info(
            `shift4DelayedCharge: Stored transaction_id ${newTransactionId} for customer ${customer.id}`,
          );
        } catch (updateError) {
          logger.error(
            `shift4DelayedCharge: CRITICAL - Charge succeeded but failed to store transaction_id ${newTransactionId} for customer ${customer.id}. Manual intervention required to prevent future U02 failures.`,
            updateError,
          );
        }
      }
    }

    return {
      result: saleResponseData,
      success,
      responseCode: saleResponseData?.transaction?.responseCode,
      responseData: saleResponseData,
      invoiceId,
    };
  } catch (error) {
    logger.error('shift4DelayedCharge: Error processing delayed charge', error);
    throw error;
  }
}

class Shift4AutoChargeExecutor implements IAutoChargeExecutor {
  async executeAutoCharge(
    request: AutoChargeExecutionRequest,
  ): Promise<AutoChargeExecutionResult> {
    const {
      bookingIdPrefix,
      hotel,
      hotelConfig,
      reservations,
      amount,
      paymentId,
      isManualCharge,
    } = request;

    const payment = await paymentService.getPaymentById(paymentId);
    if (!payment || !payment.payment_link_id) {
      throw new NoDataError(
        `Payment or invoice ID not found for payment ${paymentId}`,
      );
    }
    const invoiceId = payment.payment_link_id;

    const chargeResult = await shift4DelayedCharge({
      bookingId: bookingIdPrefix,
      hotel,
      hotelConfig,
      reservations,
      chargeAmount: amount,
      invoiceId,
      isManualCharge,
    });

    if (chargeResult.success) {
      return {
        success: true,
        provider: PaymentProvider.SHIFT4,
        bookingConfirmationId: invoiceId,
        providerResponseCode: chargeResult.responseCode,
        raw: chargeResult.result,
      };
    }

    return {
      success: false,
      provider: PaymentProvider.SHIFT4,
      providerResponseCode: chargeResult.responseCode,
      error: `Charge failed with response code: ${chargeResult.responseCode}`,
      raw: chargeResult.result,
    };
  }
}

const shift4AutoChargeExecutor = new Shift4AutoChargeExecutor();
export default shift4AutoChargeExecutor;
