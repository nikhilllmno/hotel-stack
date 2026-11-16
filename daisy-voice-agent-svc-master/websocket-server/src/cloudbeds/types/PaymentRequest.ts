/**
 * Request / response shapes for Cloudbeds' payment-related endpoints.
 */

import { CloudbedsApiEnvelope } from './CloudbedsApiEnvelope';

// ─── GET /getPaymentMethods ─────────────────────────────────────────────────

export interface CloudbedsGetPaymentMethodsQuery {
  propertyID: string;
}

export interface CloudbedsPaymentMethodCardType {
  cardCode: string;
  cardName: string;
}

export interface CloudbedsPaymentMethodEntry {
  method: string;
  code: string;
  name: string;
  cardTypes?: CloudbedsPaymentMethodCardType[];
}

export interface CloudbedsPaymentGateway {
  name: string;
  currency: string;
}

export interface CloudbedsGetPaymentMethodsResponseData {
  propertyID: string;
  methods: CloudbedsPaymentMethodEntry[];
  gateway: CloudbedsPaymentGateway;
}

// ─── POST /postPayment ───────────────────────────────────────────────────────

/**
 * The `type` value must match a `method` field returned by `GET /getPaymentMethods`
 * for the property. Known values from the API are listed here; the string fallback
 * allows forward-compatibility with new method types.
 */
export type CloudbedsPaymentType =
  | 'cash'
  | 'check'
  | 'credit'
  | 'debit'
  | 'affirm'
  | 'apple_pay'
  | 'google_pay'
  | 'pay_by_link'
  | 'other'
  | (string & {}); // allow any method value the property returns

export interface CloudbedsPostPaymentRequest {
  propertyID: string;
  reservationID: string;
  type: CloudbedsPaymentType;
  amount: number;
  description?: string;
  /**
   * Card brand code (e.g. "visa", "master"). Only relevant — and should only
   * be included — when `type === 'credit'`. Cloudbeds ignores it otherwise.
   */
  cardType?: string;
  /** Last 4 digits of the card, for receipt formatting. Only used with `type === 'credit'`. */
  cardNumber?: string;
}

export interface CloudbedsPostPaymentResponseData {
  paymentID: string;
  transactionID: string;
}

/**
 * Raw HTTP response body from `POST /postPayment`.
 *
 * Like `postReservation`, this endpoint returns a flat envelope — payload
 * fields sit alongside `success` and `message` at the top level with no
 * nested `data` key.
 */
export type CloudbedsPostPaymentRawResponse =
  | ({ success: true; message?: null } & CloudbedsPostPaymentResponseData)
  | { success: false; message: string };

// ─── POST /postCreditCard (Cloudbeds SDK flow) ──────────────────────────────

export interface CloudbedsPostCreditCardRequest {
  propertyID: string;
  reservationID: string;
  paymentMethodId: string;
  returnUrl?: string;
}

export interface CloudbedsPostCreditCardResponseData {
  cardID: string;
  cardNumber: string;
  cardType: string;
  redirectUrl?: string | null;
  paymentMethodId?: string | null;
}

export type CloudbedsPostCreditCardRawResponse =
  CloudbedsApiEnvelope<CloudbedsPostCreditCardResponseData>;

// ─── POST /postCharge (Cloudbeds SDK flow) ───────────────────────────────────

export type CloudbedsChargeStatus =
  | 'successful'
  | 'failed'
  | 'pending'
  | 'canceled'
  | 'unconfirmed';

export interface CloudbedsPostChargeRequest {
  propertyID: string;
  reservationID: string;
  paymentMethodId: string;
  amount: string;
  currency: string;
  description?: string;
  isDeposit?: boolean;
  redirectUrl?: string;
}

export interface CloudbedsPostChargeResponseData {
  paymentID: string;
  transactionID: string;
  paymentStatus: CloudbedsChargeStatus;
  paymentType?: string;
  nextAction?: {
    type?: string;
    details?: {
      url?: string;
      method?: string;
    };
  };
}

export type CloudbedsPostChargeRawResponse =
  CloudbedsApiEnvelope<CloudbedsPostChargeResponseData>;
