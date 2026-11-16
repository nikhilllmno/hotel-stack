/**
 * Common enums for the application
 */

/**
 * Standard HTTP methods
 */
export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH',
  OPTIONS = 'OPTIONS',
  HEAD = 'HEAD',
}

export enum PromiseSettledStatus {
  FULFILLED = 'fulfilled',
  REJECTED = 'rejected',
}

export enum CheckInMessageAction {
  API_TRIGGER = 'API_TRIGGER',
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  CANCEL = 'CANCEL',
}

export enum Country {
  US = 'US',
  UK = 'UK',
  CA = 'CA',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export enum PmsProvider {
  'RESNEXUS' = 'resnexus',
  'STAYNTOUCH' = 'stayntouch',
  'HOSTAWAY' = 'hostaway',
  'CLOUDBEDS' = 'cloudbeds',
  'MEWS' = 'mews',
  'CALRY' = 'calry',
}

export enum PaymentProvider {
  STRIPE = 'stripe',
  SHIFT4 = 'shift4',
  MEWS = 'mews',
  CLOUDBEDS_SDK = 'cloudbeds_sdk',
  AUTHORIZE_NET = 'authorize_net',
  /**
   * Opera settles the card itself through the property's OPI integration, so
   * the money never moves on a Dextr rail. Only Opera-backed Calry hotels use
   * this; hotels whose money moves on Stripe or Shift4 keep those values and
   * have the collected amount recorded on the Opera folio afterwards.
   */
  OPERA = 'opera',
  /**
   * ResNexus takes the card in `addreservation`, which has no amount field and
   * returns no charge result, and the property handles the deposit, balance and
   * refunds. Dextr moves no money, so these reservations are EXTERNALLY_MANAGED
   * with no `payments` row. ResNexus hotels still on Stripe keep that value.
   */
  RESNEXUS = 'resnexus',
  UNKNOWN = 'unknown',
  NOT_APPLICABLE = 'not_applicable',
}

/**
 * Providers where Dextr moves no money, so reservations are created
 * NOT_APPLICABLE with no payment. Cloudbeds SDK hotels only get the card
 * attached in Cloudbeds and charge it there themselves.
 */
export function takesNoDextrPayment(
  provider: PaymentProvider | string | null | undefined,
): boolean {
  return (
    provider === PaymentProvider.NOT_APPLICABLE ||
    provider === PaymentProvider.CLOUDBEDS_SDK
  );
}

export enum OAuthProvider {
  AUTHORIZENET = 'authorizenet',
  REMOTELOCK = 'remotelock',
}
