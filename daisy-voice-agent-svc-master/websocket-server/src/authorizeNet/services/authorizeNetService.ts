/* global setInterval, setTimeout, clearInterval, clearTimeout */
import { APIContracts, APIControllers } from 'authorizenet';
import config from '../../config';
import { Customer } from '../../dtos/Customer';
import { AuthorizeNetError } from '../../errors/AuthorizeNetError';
import { PmsCardDetails } from '../../pms/types/IPMSReservationService';
import {
  IPaymentProviderService,
  PaymentLinkParams,
  PaymentLinkResponse,
} from '../../services/payment/IPaymentProviderService';
import { generateInvoiceId } from '../../utils/helper';
import logger from '../../utils/logger';
import { AUTHNET_URLS } from '../types';

export interface OpaqueData {
  dataDescriptor: string;
  dataValue: string;
}

export interface CofFieldsFirstCharge {
  isFirstSubsequentAuth: true;
}

export interface ChargeResult {
  transactionId: string;
  networkTransId: string;
  authCode: string;
  accountNumber: string;
  accountType: string;
}

export interface CustomerProfileResult {
  customerProfileId: string;
  paymentProfileId: string;
}

export interface ProfileIds {
  customerProfileId: string;
  paymentProfileId: string;
}

export interface CofFieldsProfileCharge {
  originalNetworkTransId?: string;
  originalAuthAmount?: number;
}

export interface RefundResult {
  transactionId: string;
}

type ValuesOf<T extends Record<string, readonly string[]>> = {
  [K in keyof T]: T[K][number];
};

const CARD_CHECK_CODES = {
  responseCode: ['1', '2', '3', '4'],
  avsResultCode: [
    'A',
    'B',
    'E',
    'G',
    'N',
    'P',
    'R',
    'S',
    'U',
    'W',
    'X',
    'Y',
    'Z',
  ],
  cvvResultCode: ['M', 'N', 'P', 'S', 'U'],
} as const;

type CardCheckCode = ValuesOf<typeof CARD_CHECK_CODES>;

type ResponseReasonCode = `${number}`;

export type CardCheckOutcome = 'approved' | 'declined' | 'unavailable';

interface CardCheckBillingAddress {
  firstName: string | null;
  lastName: string | null;
  address: string;
  city: string | null;
  state: string | null;
  zip: string;
  country: string | null;
}

type CardCheckResponse = {
  [K in keyof CardCheckCode]: CardCheckCode[K] | null;
} & {
  transId: string | null;
  reasonCode: ResponseReasonCode | null;
  messageCode: string | null;
};

function toBillTo(customer: Customer): CardCheckBillingAddress | null {
  const address = customer.billing_address?.address_first_line
    ? customer.billing_address
    : customer.address;
  if (!address?.address_first_line || !address.postal_code) {
    return null;
  }
  return {
    firstName: customer.first_name?.slice(0, 50) || null,
    lastName: customer.last_name?.slice(0, 50) || null,
    address: address.address_first_line.slice(0, 60),
    city: address.city?.slice(0, 40) || null,
    state: address.state_or_province?.slice(0, 40) || null,
    zip: address.postal_code.slice(0, 20),
    country: address.country?.slice(0, 60) || null,
  };
}

interface CardCheckTransactionRequest {
  transactionType: string;
  amount: number;
  payment: {
    creditCard: {
      cardNumber: string;
      expirationDate: string;
      cardCode: string;
    };
  };
  billTo: CardCheckBillingAddress;
  transactionSettings: { settingName: string; settingValue: string }[];
}

function oneOf<T extends string>(
  allowed: readonly T[],
  value: unknown,
): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

interface RawCreateTransactionResponse {
  transactionResponse?: {
    responseCode?: unknown;
    avsResultCode?: unknown;
    cvvResultCode?: unknown;
    transId?: unknown;
    errors?: { errorCode?: unknown; errorText?: unknown }[];
  };
  messages?: {
    resultCode?: unknown;
    message?: { code?: unknown; text?: unknown }[];
  };
}

function toCardCheckResponse(
  response: RawCreateTransactionResponse,
): CardCheckResponse {
  const txn = response?.transactionResponse;
  const reasonCode = txn?.errors?.[0]?.errorCode;
  const transId = txn?.transId;
  return {
    responseCode: oneOf(CARD_CHECK_CODES.responseCode, txn?.responseCode),
    avsResultCode: oneOf(CARD_CHECK_CODES.avsResultCode, txn?.avsResultCode),
    cvvResultCode: oneOf(CARD_CHECK_CODES.cvvResultCode, txn?.cvvResultCode),
    transId:
      typeof transId === 'string' && transId !== '0' && transId !== ''
        ? transId
        : null,
    reasonCode:
      typeof reasonCode === 'string' && /^\d+$/.test(reasonCode)
        ? (reasonCode as ResponseReasonCode)
        : null,
    messageCode:
      typeof response?.messages?.message?.[0]?.code === 'string'
        ? response.messages.message[0].code
        : null,
  };
}

const INVALID_CARD_REASON_CODES: ReadonlySet<ResponseReasonCode> = new Set([
  '6',
  '7',
  '8',
  '37',
  '78',
]);

function toOutcome({
  responseCode,
  cvvResultCode,
  reasonCode,
}: CardCheckResponse): CardCheckOutcome {
  if (responseCode === '1') {
    return cvvResultCode === 'N' ? 'declined' : 'approved';
  }
  if (
    responseCode === '2' ||
    (responseCode === '3' && INVALID_CARD_REASON_CODES.has(reasonCode!))
  ) {
    return 'declined';
  }
  // 4 is "held for review" by Dextr's own fraud filters, which says nothing about the guest's card.
  return 'unavailable';
}

function getApiEndpoint(): string {
  return AUTHNET_URLS[config.AUTHORIZE_NET_ENVIRONMENT].api;
}

function createMerchantAuth(
  accessToken: string,
): APIContracts.MerchantAuthenticationType {
  const merchantAuth = new APIContracts.MerchantAuthenticationType();
  merchantAuth.setAccessToken(accessToken);
  return merchantAuth;
}

const CONTROLLER_TIMEOUT_MS = config.API_TIMEOUT + 5000;

/**
 * The Auth.net SDK's `execute` callback is only invoked on a successful HTTP
 * response with defined `data`. Transport errors (5xx, DNS, timeout) set
 * `controller._error` but never call the callback, leaving a plain
 * `new Promise(cb => controller.execute(cb))` hanging forever.
 *
 * This wrapper races the callback against a polling interval that checks
 * `controller.getError()`, guaranteeing the promise always settles.
 */
function executeController<T>(
  controller: APIControllers.ANetApiController,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const errorPollInterval = setInterval(() => {
      const err = controller.getError();
      if (err && !settled) {
        settled = true;
        clearInterval(errorPollInterval);
        clearTimeout(absoluteTimeout);
        reject(
          new AuthorizeNetError(`Authorize.net API error: ${String(err)}`, 502),
        );
      }
    }, 500);

    const absoluteTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        clearInterval(errorPollInterval);
        const err = controller.getError();
        reject(
          new AuthorizeNetError(
            `Authorize.net request timed out after ${CONTROLLER_TIMEOUT_MS}ms${err ? `: ${String(err)}` : ''}`,
            502,
          ),
        );
      }
    }, CONTROLLER_TIMEOUT_MS);

    controller.execute(() => {
      if (settled) return;
      settled = true;
      clearInterval(errorPollInterval);
      clearTimeout(absoluteTimeout);

      const error = controller.getError();
      if (error) {
        reject(
          new AuthorizeNetError(
            `Authorize.net API error: ${String(error)}`,
            502,
          ),
        );
        return;
      }
      const response = controller.getResponse();
      if (!response) {
        reject(
          new AuthorizeNetError('Authorize.net returned no response', 502),
        );
        return;
      }
      resolve(response as T);
    });
  });
}

export class AuthorizeNetService implements IPaymentProviderService {
  async chargeWithNonce(
    accessToken: string,
    amount: number,
    opaqueData: OpaqueData,
    cofFields: CofFieldsFirstCharge,
  ): Promise<ChargeResult> {
    const merchantAuth = createMerchantAuth(accessToken);

    const opaqueDataType = new APIContracts.OpaqueDataType();
    opaqueDataType.setDataDescriptor(opaqueData.dataDescriptor);
    opaqueDataType.setDataValue(opaqueData.dataValue);

    const payment = new APIContracts.PaymentType();
    payment.setOpaqueData(opaqueDataType);

    const transactionRequest = new APIContracts.TransactionRequestType();
    transactionRequest.setTransactionType(
      APIContracts.TransactionTypeEnum.AUTHCAPTURETRANSACTION,
    );
    transactionRequest.setAmount(amount);
    transactionRequest.setPayment(payment);

    if (config.AUTHORIZE_NET_SOLUTION_ID) {
      const solution = new APIContracts.SolutionType();
      solution.setId(config.AUTHORIZE_NET_SOLUTION_ID);
      transactionRequest.setSolution(solution);
    }

    if (cofFields.isFirstSubsequentAuth) {
      // CIT: Guest is present — marks this as the first in a card-on-file series
      const processingOptions = new APIContracts.ProcessingOptions();
      processingOptions.setIsFirstSubsequentAuth('true');
      transactionRequest.setProcessingOptions(processingOptions);

      const authIndicator = new APIContracts.AuthorizationIndicatorType();
      authIndicator.setAuthorizationIndicator('pre');
      transactionRequest.setAuthorizationIndicatorType(authIndicator);
    }

    const request = new APIContracts.CreateTransactionRequest();
    request.setMerchantAuthentication(merchantAuth);
    request.setTransactionRequest(transactionRequest);

    const controller = new APIControllers.CreateTransactionController(
      request.getJSON(),
    );
    controller.setEnvironment(getApiEndpoint());

    const response = await executeController<any>(controller);
    const txn = response.transactionResponse;

    if (!txn || txn.responseCode !== '1') {
      const errorMsg =
        txn?.errors?.[0]?.errorText ||
        response.messages?.message?.[0]?.text ||
        'Transaction failed';
      logger.error(
        'AuthorizeNetService::chargeWithNonce - transaction failed',
        {
          responseCode: txn?.responseCode,
          errors: txn?.errors,
        },
      );
      throw new AuthorizeNetError(`Authorize.net charge failed: ${errorMsg}`);
    }

    return {
      transactionId: txn.transId,
      networkTransId: txn.networkTransId,
      authCode: txn.authCode,
      accountNumber: txn.accountNumber,
      accountType: txn.accountType,
    };
  }

  async chargeWithProfile(
    accessToken: string,
    amount: number,
    profileIds: ProfileIds,
    cofFields?: CofFieldsProfileCharge,
  ): Promise<ChargeResult> {
    const merchantAuth = createMerchantAuth(accessToken);

    const profileToCharge = new APIContracts.CustomerProfilePaymentType();
    profileToCharge.setCustomerProfileId(profileIds.customerProfileId);
    const paymentProfile = new APIContracts.PaymentProfile();
    paymentProfile.setPaymentProfileId(profileIds.paymentProfileId);
    profileToCharge.setPaymentProfile(paymentProfile);

    const transactionRequest = new APIContracts.TransactionRequestType();
    transactionRequest.setTransactionType(
      APIContracts.TransactionTypeEnum.AUTHCAPTURETRANSACTION,
    );
    transactionRequest.setAmount(amount);
    transactionRequest.setProfile(profileToCharge);

    if (config.AUTHORIZE_NET_SOLUTION_ID) {
      const solution = new APIContracts.SolutionType();
      solution.setId(config.AUTHORIZE_NET_SOLUTION_ID);
      transactionRequest.setSolution(solution);
    }

    // MIT: Merchant-initiated — guest is not present at charge time
    const processingOptions = new APIContracts.ProcessingOptions();
    processingOptions.setIsSubsequentAuth('true');
    transactionRequest.setProcessingOptions(processingOptions);

    if (cofFields?.originalNetworkTransId) {
      // Link to the original CIT via networkTransId for better interchange rates
      const subsequentAuthInfo = new APIContracts.SubsequentAuthInformation();
      subsequentAuthInfo.setOriginalNetworkTransId(
        cofFields.originalNetworkTransId,
      );
      subsequentAuthInfo.setOriginalAuthAmount(
        cofFields.originalAuthAmount ?? 0,
      );
      subsequentAuthInfo.setReason('resubmission');
      transactionRequest.setSubsequentAuthInformation(subsequentAuthInfo);
    }

    const request = new APIContracts.CreateTransactionRequest();
    request.setMerchantAuthentication(merchantAuth);
    request.setTransactionRequest(transactionRequest);

    const controller = new APIControllers.CreateTransactionController(
      request.getJSON(),
    );
    controller.setEnvironment(getApiEndpoint());

    const response = await executeController<any>(controller);
    const txn = response.transactionResponse;

    if (!txn || txn.responseCode !== '1') {
      const errorMsg =
        txn?.errors?.[0]?.errorText ||
        response.messages?.message?.[0]?.text ||
        'Profile charge failed';
      logger.error('AuthorizeNetService::chargeWithProfile - failed', {
        responseCode: txn?.responseCode,
        errors: txn?.errors,
        customerProfileId: profileIds.customerProfileId,
      });
      throw new AuthorizeNetError(
        `Authorize.net profile charge failed: ${errorMsg}`,
      );
    }

    return {
      transactionId: txn.transId,
      networkTransId: txn.networkTransId,
      authCode: txn.authCode,
      accountNumber: txn.accountNumber,
      accountType: txn.accountType,
    };
  }

  async createProfileFromNonce(
    accessToken: string,
    opaqueData: OpaqueData,
    merchantCustomerId: string,
    email?: string,
  ): Promise<CustomerProfileResult> {
    const merchantAuth = createMerchantAuth(accessToken);

    const opaqueDataType = new APIContracts.OpaqueDataType();
    opaqueDataType.setDataDescriptor(opaqueData.dataDescriptor);
    opaqueDataType.setDataValue(opaqueData.dataValue);

    const paymentType = new APIContracts.PaymentType();
    paymentType.setOpaqueData(opaqueDataType);

    const paymentProfile = new APIContracts.CustomerPaymentProfileType();
    paymentProfile.setPayment(paymentType);

    const profile = new APIContracts.CustomerProfileType();
    profile.setMerchantCustomerId(merchantCustomerId);
    if (email) {
      profile.setEmail(email);
    }
    profile.setPaymentProfiles([paymentProfile]);

    const request = new APIContracts.CreateCustomerProfileRequest();
    request.setMerchantAuthentication(merchantAuth);
    request.setProfile(profile);
    request.setValidationMode(APIContracts.ValidationModeEnum.LIVEMODE);

    const controller = new APIControllers.CreateCustomerProfileController(
      request.getJSON(),
    );
    controller.setEnvironment(getApiEndpoint());

    const response = await executeController<any>(controller);

    if (
      response.messages?.resultCode !== 'Ok' &&
      response.messages?.resultCode !== 'OK'
    ) {
      const errorMsg =
        response.messages?.message?.[0]?.text ||
        'Profile creation from nonce failed';
      logger.error('AuthorizeNetService::createProfileFromNonce - failed', {
        messages: response.messages,
        merchantCustomerId,
      });
      throw new AuthorizeNetError(
        `Authorize.net profile creation from nonce failed: ${errorMsg}`,
      );
    }

    const customerProfileId: string = response.customerProfileId;
    const paymentProfileId: string =
      response.customerPaymentProfileIdList?.numericString?.[0] ||
      response.customerPaymentProfileIdList?.[0];

    if (!customerProfileId || !paymentProfileId) {
      throw new AuthorizeNetError(
        'Authorize.net profile creation response missing profile IDs',
      );
    }

    return { customerProfileId, paymentProfileId };
  }

  async createCustomerProfileFromTransaction(
    accessToken: string,
    transactionId: string,
  ): Promise<CustomerProfileResult> {
    const merchantAuth = createMerchantAuth(accessToken);

    const request =
      new APIContracts.CreateCustomerProfileFromTransactionRequest();
    request.setMerchantAuthentication(merchantAuth);
    request.setTransId(transactionId);

    const controller =
      new APIControllers.CreateCustomerProfileFromTransactionController(
        request.getJSON(),
      );
    controller.setEnvironment(getApiEndpoint());

    const response = await executeController<any>(controller);

    if (
      response.messages?.resultCode !== 'Ok' &&
      response.messages?.resultCode !== 'OK'
    ) {
      const errorMsg =
        response.messages?.message?.[0]?.text || 'Profile creation failed';
      logger.error(
        'AuthorizeNetService::createCustomerProfileFromTransaction - failed',
        { messages: response.messages, transactionId },
      );
      throw new AuthorizeNetError(
        `Authorize.net profile creation failed: ${errorMsg}`,
      );
    }

    const customerProfileId: string = response.customerProfileId;
    const paymentProfileId: string =
      response.customerPaymentProfileIdList?.numericString?.[0] ||
      response.customerPaymentProfileIdList?.[0];

    if (!customerProfileId || !paymentProfileId) {
      throw new AuthorizeNetError(
        'Authorize.net profile creation response missing profile IDs',
      );
    }

    return { customerProfileId, paymentProfileId };
  }

  async refundTransaction(
    accessToken: string,
    amount: number,
    refTransId: string,
    lastFour: string,
  ): Promise<RefundResult> {
    const merchantAuth = createMerchantAuth(accessToken);

    const creditCard = new APIContracts.CreditCardType();
    creditCard.setCardNumber(lastFour);
    creditCard.setExpirationDate('XXXX');

    const payment = new APIContracts.PaymentType();
    payment.setCreditCard(creditCard);

    const transactionRequest = new APIContracts.TransactionRequestType();
    transactionRequest.setTransactionType(
      APIContracts.TransactionTypeEnum.REFUNDTRANSACTION,
    );
    transactionRequest.setAmount(amount);
    transactionRequest.setPayment(payment);
    transactionRequest.setRefTransId(refTransId);

    if (config.AUTHORIZE_NET_SOLUTION_ID) {
      const solution = new APIContracts.SolutionType();
      solution.setId(config.AUTHORIZE_NET_SOLUTION_ID);
      transactionRequest.setSolution(solution);
    }

    const request = new APIContracts.CreateTransactionRequest();
    request.setMerchantAuthentication(merchantAuth);
    request.setTransactionRequest(transactionRequest);

    const controller = new APIControllers.CreateTransactionController(
      request.getJSON(),
    );
    controller.setEnvironment(getApiEndpoint());

    const response = await executeController<any>(controller);
    const txn = response.transactionResponse;

    if (!txn || txn.responseCode !== '1') {
      const errorMsg =
        txn?.errors?.[0]?.errorText ||
        response.messages?.message?.[0]?.text ||
        'Refund failed';
      logger.error('AuthorizeNetService::refundTransaction - failed', {
        responseCode: txn?.responseCode,
        errors: txn?.errors,
        refTransId,
      });
      throw new AuthorizeNetError(`Authorize.net refund failed: ${errorMsg}`);
    }

    return { transactionId: txn.transId };
  }

  async createPaymentLink(
    params: PaymentLinkParams,
  ): Promise<PaymentLinkResponse> {
    const hotelPath = params.metadata.hotel_name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    const invoiceId = generateInvoiceId();
    const paymentLink = `${config.SECURE_URL}/${hotelPath}/${invoiceId}`;

    return { url: paymentLink, id: invoiceId };
  }

  async verifyCard(
    card: PmsCardDetails,
    customer: Customer,
  ): Promise<CardCheckOutcome> {
    const billTo = toBillTo(customer);
    if (
      !billTo ||
      !config.AUTHORIZE_NET_VERIFY_API_LOGIN_ID ||
      !config.AUTHORIZE_NET_VERIFY_TRANSACTION_KEY
    ) {
      logger.error(
        `AuthorizeNetService::verifyCard - no credentials, or customer ${customer.id} has no street address and zip`,
      );
      return 'unavailable';
    }

    const transactionRequest: CardCheckTransactionRequest = {
      transactionType: APIContracts.TransactionTypeEnum.AUTHONLYTRANSACTION,
      amount: 0,
      payment: {
        creditCard: {
          cardNumber: card.pan,
          expirationDate: `${card.expiryYear}-${String(card.expiryMonth).padStart(2, '0')}`,
          cardCode: card.cvv,
        },
      },
      billTo,
      // Disable the 2 minute duplicate filter (reason 11) so a guest can retry the same card; $0 can't double charge.
      transactionSettings: [
        { settingName: 'duplicateWindow', settingValue: '0' },
      ],
    };

    // Created empty so its fields keep the order the API requires. Built from
    // an object it drops the clientId slot, which the SDK then appends last,
    // and Authorize.net rejects the request (E00003).
    const request = new APIContracts.CreateTransactionRequest();
    request.setMerchantAuthentication(
      new APIContracts.MerchantAuthenticationType({
        name: config.AUTHORIZE_NET_VERIFY_API_LOGIN_ID,
        transactionKey: config.AUTHORIZE_NET_VERIFY_TRANSACTION_KEY,
      }),
    );
    request.setTransactionRequest(
      new APIContracts.TransactionRequestType(transactionRequest),
    );

    const controller = new APIControllers.CreateTransactionController(
      request.getJSON(),
    );
    controller.setEnvironment(getApiEndpoint());

    try {
      const result = toCardCheckResponse(
        await executeController<RawCreateTransactionResponse>(controller),
      );
      const outcome = toOutcome(result);
      logger.info('AuthorizeNetService::verifyCard - result', {
        ...result,
        outcome,
      });
      return outcome;
    } catch (error) {
      logger.error('AuthorizeNetService::verifyCard - failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      return 'unavailable';
    }
  }

  async disablePaymentLink(
    paymentLinkId: string,
    _connectedAccountID?: string,
  ): Promise<void> {
    logger.info(
      `AuthorizeNet payment link ${paymentLinkId} marked as disabled (no provider-side action needed)`,
    );
  }
}

const authorizeNetService = new AuthorizeNetService();
export default authorizeNetService;

export const __for_testing = {
  toCardCheckResponse,
  toOutcome,
};
