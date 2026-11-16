// Hotel Primary Charge Type
export enum HotelPrimaryChargeType {
  LODGING = 1,
  RESTAURANT = 2,
  GIFT_SHOP = 3,
}

// Hotel Special Code
export enum HotelSpecialCode {
  NO_SPECIAL_CODE = 1,
  ASSURED_RESERVATION_NO_SHOW = 2,
  ADVANCE_DEPOSIT = 3,
  DELAYED_CHARGE = 4, // Requires additionalCharges field
  EXPRESS_CHECK_OUT_SERVICE = 5,
  ASSURED_RESERVATION_NORMAL = 6,
}

// Ref: https://docs.shift4.com/guides/appendices/api-options
export enum TransactionAuthorizationRequestOptions {
  ALLOWPARTIALAUTH = 'ALLOWPARTIALAUTH',
  POSHANDLEAVSFAIL = 'POSHANDLEAVSFAIL',
  RETURNEXPDATE = 'RETURNEXPDATE',
}

// Security Code Indicator
export enum SecurityCodeIndicator {
  NOT_PROVIDED = '0',
  PROVIDED = '1',
  ILLEGIBLE = '2',
  NOT_ON_CARD = '9',
}

// Shift4 Transaction Response Code
export enum Shift4ResponseCode {
  APPROVED = 'A',
  APPROVED_CEILING = 'C', // Approved without additional auth (below ceiling amount)
  DECLINED = 'D',
  ERROR = 'e',
  AVS_CSC_FAILURE = 'f', // AVS or CSC failure (only if POSHANDLEAVSFAIL sent)
  PARTIAL_APPROVAL = 'P',
  VOICE_REFERRAL = 'R',
  UNKNOWN = '', // Status is unknown (blank)
  EXPIRED_CARD = 'X',
  SCA_ONLINE_PIN_REQUIRED = 'S', // Strong customer authentication - online PIN required
  SCA_INTERFACE_SWITCH_REQUIRED = 'I', // Strong customer authentication - interface switch required
}

// Additional Charge Types (Y/N values)
export enum AdditionalChargeValue {
  YES = 'Y',
  NO = 'N',
}

// Card Present Options (Y/N values)
export enum CardPresent {
  YES = 'Y',
  NO = 'N',
}

// Card On File Transaction Types
export enum CardOnFileType {
  // Cardholder-initiated, storing card for future use (not recurring). 3DS - yes.
  S01 = 'S01',
  // Cardholder-initiated, storing card for recurring payments. 3DS - yes.
  S02 = 'S02',
  // Cardholder-initiated unscheduled transaction using stored card. 3DS - yes.
  U01 = 'U01',
  // Merchant-initiated unscheduled transaction using stored card. 3DS - no.
  U02 = 'U02',
  // Merchant-initiated recurring payment using stored card. 3DS - no.
  U03 = 'U03',
  // Reauthorization COF transaction. 3DS - no.
  U04 = 'U04',
  // Resubmission COF transaction (declined due to insufficient funds). 3DS - no.
  U05 = 'U05',
  // Estimated Authorization COF transaction. 3DS - no.
  U06 = 'U06',
  // Delayed Charges COF transaction (e.g., hotel room damages after checkout). 3DS - no.
  U07 = 'U07',
  // Incremental COF transaction (e.g., extending hotel stay). 3DS - no.
  U08 = 'U08',
  // No Show COF transaction (e.g., hotel no-show charge). 3DS - no.
  U09 = 'U09',
}

// 3D Secure Initiate Options
export enum ThreeDSecureInitiate {
  FORCE_3DS = '01', // Force 3D Secure authentication
  INITIATE_BY_ADVISER = '03', // Initiate 3D Secure according to the 3D Secure Adviser result
}

// 3D Secure Challenge Window Size
export enum ThreeDSecureChallengeWindowSize {
  SIZE_250x400 = '01', // 250 x 400 pixels
  SIZE_390x400 = '02', // 390 x 400 pixels
  SIZE_500x600 = '03', // 500 x 600 pixels
  SIZE_600x400 = '04', // 600 x 400 pixels
  FULL_SCREEN = '05', // Full screen
}

// 3D Secure Transaction Type
export enum ThreeDSecureTransType {
  GOODS_SERVICE_PURCHASE = '01', // Goods / Service purchase
  CHECK_ACCEPTANCE = '03', // Check Acceptance
  ACCOUNT_FUNDING = '10', // Account Funding
  QUASI_CASH = '11', // Quasi-Cash Transaction
  PREPAID_ACTIVATION_LOAN = '28', // Prepaid activation and Loan
}

// 3D Secure Challenge Request Indicator
export enum ThreeDSecureReqChallengeInd {
  NO_PREFERENCE = '01', // No preference
  NO_CHALLENGE_REQUESTED = '02', // No challenge requested
  CHALLENGE_REQUESTED_MERCHANT = '03', // Challenge requested by merchant
  CHALLENGE_REQUESTED_MANDATE = '04', // Challenge requested: Mandate
  NO_CHALLENGE_TRA_PERFORMED = '05', // No Challenge Requested, transactional risk analysis is already performed
  NO_CHALLENGE_DATA_SHARE_ONLY = '06', // No Challenge Requested, Data share only
  NO_CHALLENGE_SCA_PERFORMED = '07', // No Challenge Requested, SCA is already performed
  NO_CHALLENGE_WHITELIST_EXEMPTION = '08', // No challenge requested (utilise whitelist exemption if no challenge required)
  CHALLENGE_WHITELIST_PROMPT = '09', // Challenge requested (whitelist prompt requested if challenge required)
}

// 3D Secure Program Protocol (EMV 3-D Secure Version)
export enum ThreeDSecureProgramProtocol {
  EMV_3DS_V2_1 = '1', // EMV 3-D Secure Version 2.1
  EMV_3DS_V2_2 = '2', // EMV 3-D Secure Version 2.2
  EMV_3DS_V2_3 = '3', // EMV 3-D Secure Version 2.3
  EMV_3DS_V2_4 = '4', // EMV 3-D Secure Version 2.4
  EMV_3DS_V2_5 = '5', // EMV 3-D Secure Version 2.5
  EMV_3DS_V2_6 = '6', // EMV 3-D Secure Version 2.6
  EMV_3DS_V2_7 = '7', // EMV 3-D Secure Version 2.7
  EMV_3DS_V2_8 = '8', // EMV 3-D Secure Version 2.8
  EMV_3DS_V2_9 = '9', // EMV 3-D Secure Version 2.9
}

// 3D Secure E-commerce Indicator
export enum ThreeDSecureEcommIndicator {
  SECURE_ECOMMERCE = '5', // Secure electronic commerce transaction
  AUTHENTICATION_ATTEMPTED = '6', // Authentication attempted, non-authenticated security transaction
  NON_AUTHENTICATED = '7', // Non-authenticated Security Transaction
}

// 3D Secure Authentication Source
export enum ThreeDSecureAuthenticationSource {
  ACS = '2', // Access Control Server
}

// 3D Secure Data
export interface ThreeDSecure {
  programProtocol?: ThreeDSecureProgramProtocol; // Required for US merchants
  ecommIndicator: ThreeDSecureEcommIndicator;
  trxId: string;
  directoryServerTranId: string;
  version?: string; // Required for non-US merchants
  cryptogram: string;
  xid: string;
  securityLevelIndicator?: string;
  authenticationSource?: ThreeDSecureAuthenticationSource;
}

// Card Token Request
export interface Shift4CardTokenRequest {
  payment_id: string;
  i4go_response: string;
  i4go_responsecode: string;
  i4go_responsetext?: string;
  i4go_maskedcard: string;
  i4go_uniqueid: string;
  i4go_expirationmonth: string;
  i4go_expirationyear: string;
  i4go_cardholdername?: string;
  i4go_streetaddress?: string;
  i4go_postalcode?: string;
  i4go_extendedcarddata?: string;
  i4go_cardtype: string;
  i4go_metatoken?: string;
  i4go_utoken: string;
  i4go_applepaytoken?: string;
  i4go_googlepaytoken?: string;
  i4go_signeddata?: string;
  // Present only when 3DS ran during pre-authorization (per-hotel toggle).
  threeDSecure?: ThreeDSecure;
}

// Hotel Shift4 Configuration
export interface HotelShift4Config {
  authToken: string;
  accessToken: string;
}

// Pre-Authorization Request
export interface Shift4PreAuthRequest {
  orderNumber: string;
  amount: number;
  currencyCode: string;
  consumer: {
    mobilePhone: string;
    lastName: string;
    email: string;
    billingAddress: {
      firstName: string;
      lastName: string;
      address1: string;
      city: string;
      state: string;
      postalCode: string;
      countryCode: string;
      phone1: string;
    };
    shippingAddress: {
      firstName: string;
      lastName: string;
      address1: string;
      city: string;
      state: string;
      postalCode: string;
      countryCode: string;
      phone1: string;
    };
  };
  invoice: string;
  customerDeviceIP: string;
  hotelShift4Config: HotelShift4Config;
  /** When true, 3D Secure is applied to this pre-authorization. Defaults to off. */
  enable3DS?: boolean;
}

// Pre-Authorization Response
export interface Shift4PreAuthResponse {
  isInternational: boolean;
  i4go_countrycode: string;
  i4go_responsecode: number;
  i4go_server: string;
  i4go_accessblock: string;
  i4go_response: string;
  i4go_i4m_url: string;
}

// Sale Transaction Interfaces
export interface Shift4SaleTransactionAmount {
  total: number;
  tax: number;
}

export interface Shift4Clerk {
  numericId: number;
}

export interface Shift4HotelAdditionalCharges {
  giftShop?: AdditionalChargeValue;
  laundry?: AdditionalChargeValue;
  miniBar?: AdditionalChargeValue;
  other?: AdditionalChargeValue;
  restaurant?: AdditionalChargeValue;
  telephone?: AdditionalChargeValue;
}

export interface Shift4RoomRate {
  nights: number;
  rate: number;
}

export interface Shift4HotelTransaction {
  additionalCharges?: Shift4HotelAdditionalCharges;
  arrivalDateTime: string;
  departureDateTime: string;
  primaryChargeType: HotelPrimaryChargeType;
  roomRates: Shift4RoomRate[];
  specialCode: HotelSpecialCode;
}
export interface Shift4HotelRefundTransaction {
  arrivalDateTime: string;
  departureDateTime: string;
}

export interface Shift4PurchaseCard {
  customerReference: string;
  destinationPostalCode: string;
  productDescriptors: string[];
}

export interface Shift4CardOnFile {
  type: CardOnFileType;
  transactionId?: string;
}

export interface Shift4Transaction {
  invoice: string;
  purchaseCard: Shift4PurchaseCard;
  cardOnFile?: Shift4CardOnFile;
  hotel: Shift4HotelTransaction;
  notes?: string;
}

export interface Shift4Customer {
  addressLine1?: string;
  firstName?: string;
  lastName?: string;
  postalCode?: string;
  emailAddress?: string;
  ipAddress?: string;
}

export interface Shift4Card {
  present: CardPresent;
  token: {
    value: string;
  };
  expirationDate: number;
  securityCode?: {
    indicator: SecurityCodeIndicator;
    value?: string; // 3-4 digit CVV, should not be stored
  };
}

export enum Shift4CardType {
  AX = 'AX', // American Express
  AP = 'AP', // Alipay
  BC = 'BC', // Backed Card
  CI = 'CI', // Citgo
  DB = 'DB', // Debit card
  GC = 'GC', // Gift Card
  JC = 'JC', // JCB
  MC = 'MC', // Mastercard
  NS = 'NS', // Discover/JCB/Novus
  PL = 'PL', // Private Label
  SC = 'SC', // Sears Canada
  VS = 'VS', // Visa
  WP = 'WP', // WeChat Pay
  YC = 'YC', // IT'S YOUR CARD
}

export const Shift4ToStayntouchCardTypeMap: Partial<
  Record<Shift4CardType, string>
> = {
  [Shift4CardType.AX]: 'AX', // American Express -> American Express
  [Shift4CardType.JC]: 'JCB', // JCB -> Japan Credit Bureau
  [Shift4CardType.MC]: 'MC', // Mastercard -> Master Card
  [Shift4CardType.NS]: 'DS', // Discover/JCB/Novus -> Discover
  [Shift4CardType.VS]: 'VA', // Visa -> Visa
};

export interface Shift4ResponseCard {
  present: CardPresent;
  token: {
    value: string;
  };
  type: Shift4CardType;
  number: string;
  expirationDate: number; // MMYY
}

export interface Shift4SaleTransactionRequest {
  dateTime: string;
  amount: Shift4SaleTransactionAmount;
  clerk: Shift4Clerk;
  customer?: Shift4Customer;
  transaction: Shift4Transaction;
  threeDSecure?: ThreeDSecure;
  card: Shift4Card;
  apiOptions?: TransactionAuthorizationRequestOptions[];
}

export interface Shift4ResponseMerchant {
  mid: number;
  name: string;
}

export interface Shift4ResponseServer {
  name: string;
}

export interface Shift4ResponseHostResponse {
  reasonCode: string;
  reasonDescription: string;
  reattemptPermission: string;
}

export interface Shift4ResponseTransaction {
  authorizationCode: string;
  authSource: string;
  hostResponse: Shift4ResponseHostResponse;
  invoice: string;
  responseCode: Shift4ResponseCode;
  retrievalReference: string;
  saleFlag: string;
  cardOnFile?: Shift4CardOnFile;
}

export interface Shift4SaleTransactionResult {
  merchant: Shift4ResponseMerchant;
  server: Shift4ResponseServer;
  transaction: Shift4ResponseTransaction;
  card: Shift4ResponseCard;
  [key: string]: any;
}

export interface Shift4SaleTransactionResponse {
  result: Shift4SaleTransactionResult[];
}

// Refund Transaction Interfaces
export interface Shift4RefundTransactionRequest {
  dateTime: string; // ISO 8601 format with timezone (yyyy-mm-ddThh:mm:ss.nnn+hh:mm)
  amount: Shift4SaleTransactionAmount;
  card: Shift4Card;
  transaction: {
    invoice: string; // 10-digit invoice number for this refund
    originalInvoice: string; // Invoice number from the original sale
    notes?: string;
    purchaseCard?: Shift4PurchaseCard;
    hotel?: Shift4HotelRefundTransaction;
  };
  customer?: Shift4Customer;
}

export interface Shift4RefundTransactionResponse {
  result: Shift4SaleTransactionResult[];
}

// Error object returned in 400/504 responses and within transaction results
export interface Shift4ErrorResult {
  code?: number;
  severity?: 'Info' | 'Error' | 'Alert';
  shortText?: string;
  longText?: string;
  primaryCode?: number;
  secondaryCode?: number;
}

// Invoice Information (GetInvoice) response
// Ref: https://docs.shift4.com/apis/payments-platform-rest/openapi/transactions/getinvoice
export interface Shift4InvoiceResult {
  dateTime?: string;
  amount?: Shift4SaleTransactionAmount;
  card?: Shift4Card;
  customer?: Shift4Customer;
  clerk?: Shift4Clerk;
  merchant?: Shift4ResponseMerchant;
  transaction?: Shift4ResponseTransaction;
  server?: Shift4ResponseServer;
  error?: Shift4ErrorResult;
  [key: string]: any;
}

export interface Shift4InvoiceResponse {
  result: Shift4InvoiceResult[];
}

// Access Token API Response (raw response from Shift4 API)
export interface Shift4AccessTokenResult {
  result: Shift4AccessTokenResultData[];
}

interface Shift4AccessTokenResultData {
  dateTime: string;
  receiptColumns: number;
  credential: {
    accessToken: string;
  };
  device: {
    capability: {
      magstripe: string;
      manualEntry: string;
    };
  };
  server: {
    name: string;
  };
}
