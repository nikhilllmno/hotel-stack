import axios from 'axios';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import FormData from 'form-data';
import config from '../../config';
import { Shift4CommunicationError } from '../../errors/Shift4CommunicationError';
import { Shift4Error } from '../../errors/Shift4Error';
import { Shift4InvoiceNotFoundError } from '../../errors/Shift4InvoiceNotFoundError';
import {
  CardOnFileType,
  HotelShift4Config,
  Shift4AccessTokenResult,
  Shift4ErrorResult,
  Shift4InvoiceResponse,
  Shift4PreAuthRequest,
  Shift4PreAuthResponse,
  Shift4RefundTransactionRequest,
  Shift4RefundTransactionResponse,
  Shift4SaleTransactionRequest,
  Shift4SaleTransactionResponse,
  Shift4SaleTransactionResult,
  ThreeDSecureChallengeWindowSize,
  ThreeDSecureInitiate,
  ThreeDSecureReqChallengeInd,
  ThreeDSecureTransType,
} from '../../types/shift4';
import { generateInvoiceId } from '../../utils/helper';
import logger from '../../utils/logger';
import {
  IPaymentProviderService,
  PaymentLinkParams,
  PaymentLinkResponse,
} from '../payment/IPaymentProviderService';
dayjs.extend(utc);
dayjs.extend(timezone);

// Ref: https://docs.shift4.com/guides/response-handling/timeouts-and-communications-failures
// 65 seconds for non-PIN-pad transactions (card-not-present in our case)
const SHIFT4_GLOBAL_TIMER_MS = config.SHIFT4_GLOBAL_TIMER_MS;

// Wait 1-3 seconds (production) before sending GetInvoice after a communication failure
const SHIFT4_INVOICE_LOOKUP_DELAY_MS = config.SHIFT4_INVOICE_LOOKUP_DELAY_MS;

// Communication error codes that indicate a communication failure occurred.
// When one of these is received, the GetInvoice flow must be followed.
// Ref: https://docs.shift4.com/guides/response-handling/timeouts-and-communications-failures
const SHIFT4_COMMUNICATION_ERROR_CODES = new Set([
  1001, 2011, 4003, 9012, 9018, 9020, 9023, 9033, 9489, 9901, 9902, 9951, 9957,
  9960, 9961, 9962, 9964, 9978,
]);

export class Shift4Service implements IPaymentProviderService {
  async createPaymentLink(
    params: PaymentLinkParams,
  ): Promise<PaymentLinkResponse> {
    try {
      const paymentId = params.metadata.payment_id;
      logger.info(`Creating Shift4 payment link for payment ${paymentId}`);

      // 10-digit unique ID for Shift4 payments. For more details, ref documentation at
      // https://s4-myportal.s3.amazonaws.com/downloads/documentation/i4go/i4go%20technical%20reference%20guide.pdf
      const invoiceId = generateInvoiceId();

      const hotelPath = params.metadata.hotel_name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
      const paymentLink = `${config.SECURE_URL}/${hotelPath}/${invoiceId}`;

      return { url: paymentLink, id: invoiceId };
    } catch (error) {
      logger.error('Error creating Shift4 payment link:', error);
      throw error;
    }
  }

  async disablePaymentLink(
    paymentLinkId: string,
    connectedAccountID?: string,
  ): Promise<void> {
    logger.info(
      `Shift4 payment link ${paymentLinkId} marked as disabled (no provider-side action needed)`,
    );
  }

  async preauthorizeClient(
    params: Shift4PreAuthRequest,
  ): Promise<Shift4PreAuthResponse> {
    try {
      logger.info('preauthorizeClient: Shift4 pre-authorization request', {
        orderNumber: params.orderNumber,
        invoice: params.invoice,
      });

      const accessToken = params.hotelShift4Config?.accessToken;

      if (!accessToken) {
        throw new Shift4Error('Shift4 access token not configured', 400);
      }

      const formData = new FormData();
      formData.append('fuseaction', 'account.preauthorizeClient');
      formData.append('i4go_accesstoken', accessToken);
      formData.append('i4go_clientip', params.customerDeviceIP);

      const basketData = {
        OrderDetails: {
          OrderNumber: params.orderNumber,
          Amount: params.amount,
          CurrencyCode: params.currencyCode,
        },
        Consumer: {
          MobilePhone: params.consumer.mobilePhone,
          LastName: params.consumer.lastName,
          Email1: params.consumer.email,
          BillingAddress: params.consumer.billingAddress,
          ShippingAddress: params.consumer.shippingAddress,
        },
      };

      const enable3DS = params.enable3DS === true;

      // The i4go basket triggers 3DS from our side.
      if (enable3DS) {
        formData.append('i4go_basket', JSON.stringify(basketData));
      }

      const paymentAPIData = {
        steps: enable3DS ? ['3DS_STANDALONE', 'CARD_VERIFY'] : ['CARD_VERIFY'],
        transaction: {
          invoice: params.invoice,
          cardOnFile: {
            type: CardOnFileType.S01,
          },
        },
        // Ref https://docs.shift4.com/apis/payments-platform-rest/openapi/3d-secure/3dsecurestandalone
        // for information regarding the threedSecure parameters
        ...(enable3DS && {
          threedSecure: {
            initiate: ThreeDSecureInitiate.FORCE_3DS,
            challengeWindowSize: ThreeDSecureChallengeWindowSize.SIZE_250x400,
            transType: ThreeDSecureTransType.GOODS_SERVICE_PURCHASE,
            addressMatch: true,
            reqChallengeInd: ThreeDSecureReqChallengeInd.NO_PREFERENCE,
          },
        }),
      };
      formData.append('paymentAPI', JSON.stringify(paymentAPIData));

      logger.info('preauthorizeClient: Complete FormData contents', {
        fuseaction: 'account.preauthorizeClient',
        has_access_token: !!accessToken,
        i4go_clientip: params.customerDeviceIP,
        enable3DS,
        // Never log basketData — it carries guest PII (name, email, phone, address).
        basketAttached: enable3DS,
        paymentAPI: JSON.stringify(paymentAPIData),
      });

      const response = await axios.post<Shift4PreAuthResponse>(
        config.SHIFT4_ACCESS_URL,
        formData,
        {
          headers: formData.getHeaders(),
          timeout: 30000,
        },
      );

      logger.info('Shift4 pre-authorization response', {
        orderNumber: params.orderNumber,
        responseCode: response.data.i4go_responsecode,
        response: response.data.i4go_response,
      });

      return response.data;
    } catch (error) {
      logger.error('Error in Shift4 pre-authorization:', error);
      throw error;
    }
  }

  async saleTransaction(
    params: Shift4SaleTransactionRequest,
    accessToken: string,
  ): Promise<Shift4SaleTransactionResponse> {
    // Redact the 3DS authentication payload (cryptogram, xid, etc.) from logs;
    // it must still reach Shift4 on the request itself.
    const { threeDSecure, ...loggableParams } = params;
    logger.info('saleTransaction: Initiating Shift4 sale transaction', {
      ...loggableParams,
      threeDSecure: threeDSecure ? '[redacted]' : undefined,
    });

    if (!accessToken) {
      throw new Shift4Error('Shift4 access token not configured', 400);
    }

    return this.executeTransactionWithFailover<Shift4SaleTransactionResponse>(
      'sale',
      params,
      accessToken,
      params.transaction.invoice,
    );
  }

  async refundTransaction(
    params: Shift4RefundTransactionRequest,
    accessToken: string,
  ): Promise<Shift4RefundTransactionResponse> {
    logger.info(
      'refundTransaction: Initiating Shift4 refund transaction',
      params,
    );

    if (!accessToken) {
      throw new Shift4Error('Shift4 access token not configured', 400);
    }

    return this.executeTransactionWithFailover<Shift4RefundTransactionResponse>(
      'refund',
      params,
      accessToken,
      params.transaction.invoice,
    );
  }

  // --- GetInvoice API ---
  // Ref: https://docs.shift4.com/apis/payments-platform-rest/openapi/transactions/getinvoice
  async getInvoice(
    invoice: string,
    accessToken: string,
  ): Promise<Shift4InvoiceResponse> {
    logger.info(`getInvoice: Requesting invoice status for ${invoice}`);

    const response = await axios.get<Shift4InvoiceResponse>(
      `${config.SHIFT4_BASE_URL}/transactions/invoice`,
      {
        headers: this.getStandardHeaders(accessToken, invoice),
        timeout: SHIFT4_GLOBAL_TIMER_MS,
      },
    );

    logger.info(`getInvoice: Response for invoice ${invoice}`, response.data);
    return response.data;
  }

  // --- Transaction flow with communication failure handling ---
  // Implements the transaction flow diagram from Shift4 docs:
  // https://docs.shift4.com/guides/response-handling/timeouts-and-communications-failures
  private async executeTransactionWithFailover<
    TRes extends { result: Shift4SaleTransactionResult[] },
  >(
    endpoint: string,
    params: Record<string, any>,
    accessToken: string,
    invoice: string,
    isRetry: boolean = false,
  ): Promise<TRes> {
    try {
      // Step 1: Send transaction with global timer
      const timeout = SHIFT4_GLOBAL_TIMER_MS;
      const response = await axios.post<TRes>(
        `${config.SHIFT4_BASE_URL}/transactions/${endpoint}`,
        params,
        {
          headers: {
            'Content-Type': 'application/json',
            ...this.getStandardHeaders(accessToken),
          },
          timeout,
        },
      );

      logger.info(
        `Shift4 ${endpoint} transaction response for invoice ${invoice}`,
        response.data,
      );

      // HTTP 200 - check for communication error codes in response
      if (this.containsCommunicationErrorCode(response.data)) {
        logger.warn(
          `Communication error code detected in ${endpoint} response for invoice ${invoice}. Initiating invoice lookup.`,
        );
        return await this.handleCommunicationFailure<TRes>(
          invoice,
          accessToken,
        );
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const isTimeout =
          error.code === 'ECONNABORTED' ||
          error.code === 'ETIMEDOUT' ||
          !error.response;
        const is504 = status === 504;
        const is400WithCommError =
          status === 400 &&
          this.containsCommunicationErrorCode(error.response?.data);

        // Retry refund once
        if (endpoint === 'refund') {
          if (!isRetry) {
            logger.warn(
              `Refund comm failure for invoice ${invoice}. Retrying once.`,
            );
            return await this.executeTransactionWithFailover<TRes>(
              endpoint,
              params,
              accessToken,
              invoice,
              true,
            );
          }
          logger.error(
            `Refund comm failure for invoice ${invoice} after retry. Giving up.`,
          );
          throw new Shift4CommunicationError(
            invoice,
            'Refund failed after retry',
          );
        } else {
          // Sale policy: any communication-class failure must go through the GetInvoice
          //   lookup flow, because the original sale may have been processed upstream
          //   even though we didn't get a usable response — we must not double-charge.
          if (isTimeout) {
            logger.warn(
              `Global timer expired for ${endpoint}, invoice ${invoice}. Initiating invoice lookup.`,
            );
            return await this.handleCommunicationFailure<TRes>(
              invoice,
              accessToken,
            );
          }

          if (is504) {
            const errorResult = error.response?.data?.result?.[0]?.error;
            const errorContext = errorResult
              ? `Error: ${errorResult.shortText} (${errorResult.primaryCode}).`
              : '';
            logger.warn(
              `504 Gateway Timeout for ${endpoint}, invoice ${invoice}. ${errorContext} Initiating invoice lookup.`,
            );
            return await this.handleCommunicationFailure<TRes>(
              invoice,
              accessToken,
            );
          }

          if (status === 400) {
            if (is400WithCommError) {
              logger.warn(
                `Communication error code in 400 response for ${endpoint}, invoice ${invoice}. Initiating invoice lookup.`,
              );
              return await this.handleCommunicationFailure<TRes>(
                invoice,
                accessToken,
              );
            }
            // Genuine 400 validation/business error — surface immediately for both endpoints
            logger.error(
              `400 Error for ${endpoint}, invoice ${invoice}:`,
              error.response?.data,
            );
            throw new Shift4Error(
              `Shift4 ${endpoint} error: ${JSON.stringify(error.response?.data)}`,
              400,
            );
          }
        }
      }

      logger.error(
        `Error in Shift4 ${endpoint} transaction for invoice ${invoice}:`,
        error,
      );
      throw error;
    }
  }

  // --- Communication failure handling (GetInvoice flow) ---
  // Ref: https://docs.shift4.com/guides/response-handling/timeouts-and-communications-failures
  //
  // Flow:
  // 1. Wait 1-3 seconds
  // 2. Send GetInvoice request
  //    - "Invoice Not Found" → throw Shift4InvoiceNotFoundError (caller can retry original tx)
  //    - Invoice found (200) → return result (caller checks responseCode)
  //    - GetInvoice fails → retry once, then throw Shift4CommunicationError
  private async handleCommunicationFailure<
    TRes extends { result: Shift4SaleTransactionResult[] },
  >(
    invoice: string,
    accessToken: string,
    isRetry: boolean = false,
  ): Promise<TRes> {
    // Wait before checking invoice status
    await this.delay(SHIFT4_INVOICE_LOOKUP_DELAY_MS);

    try {
      const invoiceResponse = await this.getInvoice(invoice, accessToken);

      // Check if the invoice response itself contains an error (e.g., "Invoice Not Found" in a 200 wrapper)
      const errorResult = invoiceResponse.result?.[0]?.error;
      if (errorResult) {
        if (this.isInvoiceNotFoundError(errorResult)) {
          logger.info(
            `Invoice ${invoice} not found via GetInvoice. Original transaction was not processed.`,
          );
          throw new Shift4InvoiceNotFoundError(invoice);
        }
        // Some other error in invoice result — log for auditor review
        logger.error(
          `GetInvoice returned error for invoice ${invoice}:`,
          errorResult,
        );
        throw new Shift4CommunicationError(
          invoice,
          `GetInvoice error: ${errorResult.shortText || errorResult.longText || JSON.stringify(errorResult)}`,
        );
      }

      // Invoice found — validate required fields are present
      const invoiceResult = invoiceResponse.result?.[0];
      if (!invoiceResult?.transaction) {
        logger.error(
          `GetInvoice returned incomplete data for invoice ${invoice}. Missing transaction object.`,
        );
        throw new Shift4CommunicationError(
          invoice,
          'GetInvoice returned incomplete transaction data',
        );
      }

      if (!invoiceResult?.transaction.responseCode) {
        logger.error(
          `GetInvoice returned incomplete data for invoice ${invoice}. Missing transaction responseCode.`,
        );
        throw new Shift4CommunicationError(
          invoice,
          'GetInvoice returned incomplete transaction data',
        );
      }

      logger.info(
        `Invoice ${invoice} found via GetInvoice. Returning result for responseCode evaluation.`,
      );
      return invoiceResponse as unknown as TRes;
    } catch (error) {
      // Re-throw our own error types immediately
      if (
        error instanceof Shift4InvoiceNotFoundError ||
        error instanceof Shift4CommunicationError
      ) {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        const status = error.response?.status;

        // HTTP 400 from GetInvoice
        if (status === 400) {
          const errorData = error.response?.data;
          const errorResult = errorData?.result?.[0]?.error;

          // "Invoice Not Found" → original tx was never processed, safe to retry
          if (errorResult && this.isInvoiceNotFoundError(errorResult)) {
            logger.info(
              `Invoice ${invoice} not found (400). Original transaction was not processed.`,
            );
            throw new Shift4InvoiceNotFoundError(invoice);
          }

          logger.error(
            `GetInvoice returned 400 for invoice ${invoice}:`,
            errorData,
          );
          throw new Shift4Error(
            `Shift4 GetInvoice error: ${JSON.stringify(errorData)}`,
            400,
          );
        }

        // HTTP 504 or timeout from GetInvoice — retry once
        if (
          status === 504 ||
          error.code === 'ECONNABORTED' ||
          error.code === 'ETIMEDOUT' ||
          !error.response
        ) {
          if (!isRetry) {
            logger.warn(
              `GetInvoice failed (${status ?? 'timeout'}) for invoice ${invoice}. Retrying once.`,
            );
            return await this.handleCommunicationFailure<TRes>(
              invoice,
              accessToken,
              true,
            );
          }

          logger.error(
            `GetInvoice failed on retry for invoice ${invoice}. Communication error — log for auditor review.`,
          );
          throw new Shift4CommunicationError(
            invoice,
            `GetInvoice failed after retry (${status ?? 'timeout'})`,
          );
        }
      }

      // Any other unexpected failure — retry once, then give up
      if (!isRetry) {
        logger.warn(
          `GetInvoice encountered unexpected error for invoice ${invoice}. Retrying once.`,
          error,
        );
        return await this.handleCommunicationFailure<TRes>(
          invoice,
          accessToken,
          true,
        );
      }

      logger.error(
        `GetInvoice failed on retry for invoice ${invoice}. Communication error — log for auditor review.`,
        error,
      );
      throw new Shift4CommunicationError(
        invoice,
        `GetInvoice failed after retry: ${error}`,
      );
    }
  }

  // --- Private helpers ---

  private getStandardHeaders(
    accessToken: string,
    invoice?: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      InterfaceVersion: config.SHIFT4_INTERFACE_VERSION,
      InterfaceName: config.SHIFT4_INTERFACE_NAME,
      CompanyName: config.SHIFT4_COMPANY_NAME,
      AccessToken: accessToken,
    };
    if (invoice) {
      headers['Invoice'] = invoice;
    }
    return headers;
  }

  // Check if a Shift4 response contains any known communication error codes
  // Ref: https://docs.shift4.com/guides/response-handling/timeouts-and-communications-failures#communication-error-codes
  private containsCommunicationErrorCode(data: any): boolean {
    if (!data?.result || !Array.isArray(data.result)) return false;

    return data.result.some((item: any) => {
      const error = item?.error;
      if (!error) return false;

      if (
        error.primaryCode &&
        SHIFT4_COMMUNICATION_ERROR_CODES.has(error.primaryCode)
      )
        return true;
      if (error.code && SHIFT4_COMMUNICATION_ERROR_CODES.has(error.code))
        return true;

      return false;
    });
  }

  // Check if an error result indicates "Invoice Not Found"
  private isInvoiceNotFoundError(error: Shift4ErrorResult): boolean {
    const shortText = error.shortText?.toLowerCase() ?? '';
    const longText = error.longText?.toLowerCase() ?? '';
    return (
      shortText.includes('invoice not found') ||
      longText.includes('invoice not found')
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async generateAccessToken(hotelId: string) {
    try {
      logger.info(`Generating Shift4 access token for hotel ${hotelId}`);

      const hotelShift4Config = config.HOTEL_SHIFT4_CONFIG[hotelId] as
        | HotelShift4Config
        | undefined;

      if (!hotelShift4Config?.authToken) {
        throw new Shift4Error(
          `Shift4 auth token not configured for hotel ${hotelId}`,
          400,
        );
      }

      if (!config.SHIFT4_CLIENT_GUID) {
        throw new Shift4Error('Shift4 client GUID not configured', 500);
      }

      const requestBody = {
        dateTime: dayjs()
          .tz('America/Los_Angeles')
          .format('YYYY-MM-DDTHH:mm:ss.SSSZ'),
        credential: {
          authToken: hotelShift4Config.authToken,
          clientGuid: config.SHIFT4_CLIENT_GUID,
        },
      };

      const response = await axios.post<Shift4AccessTokenResult>(
        `${config.SHIFT4_BASE_URL}/credentials/accesstoken`,
        requestBody,
        {
          headers: {
            InterfaceVersion: config.SHIFT4_INTERFACE_VERSION,
            InterfaceName: config.SHIFT4_INTERFACE_NAME,
            CompanyName: config.SHIFT4_COMPANY_NAME,
            'Content-Type': 'application/json',
          },
          timeout: SHIFT4_GLOBAL_TIMER_MS,
        },
      );

      logger.info(
        `Shift4 access token generated successfully for hotel ${hotelId}`,
      );

      return {
        hotelId,
        accessToken: response.data.result?.[0]?.credential?.accessToken,
      };
    } catch (error) {
      logger.error(
        `Error generating Shift4 access token for hotel ${hotelId}:`,
        error,
      );
      if (axios.isAxiosError(error)) {
        throw new Shift4Error(
          error.response?.data?.message ||
            'Failed to generate Shift4 access token',
          error.response?.status || 500,
        );
      }
      throw error;
    }
  }
}

const shift4Service = new Shift4Service();

export default shift4Service;
