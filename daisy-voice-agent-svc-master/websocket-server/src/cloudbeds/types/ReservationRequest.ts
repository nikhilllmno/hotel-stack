/**
 * Request / response shapes for Cloudbeds' reservation endpoints.
 *
 * `postReservation` accepts a flat set of fields plus three nested arrays
 * (`rooms`, `adults`, `children`) that are serialized by the client's
 * form-encode helper using Cloudbeds' bracket notation
 * (`rooms[0][roomTypeID]=...`).
 */

/** Nested array entries serialized as `<name>[<index>][<key>]=<value>`. */
export interface CloudbedsReservationRoomEntry {
  roomTypeID: string;
  quantity: number;
  roomRateID?: number;
}

export interface CloudbedsReservationGuestEntry {
  roomTypeID: string;
  quantity: number;
}

export interface CloudbedsPostReservationRequest {
  propertyID: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  guestFirstName: string;
  guestLastName: string;
  guestEmail?: string;
  guestPhone?: string;
  guestCountry?: string;
  guestZip?: string;
  guestState?: string;
  guestCity?: string;
  rooms: CloudbedsReservationRoomEntry[];
  adults: CloudbedsReservationGuestEntry[];
  children: CloudbedsReservationGuestEntry[];
  paymentMethod?: 'cash' | 'credit' | 'ebanking' | 'pay_pal';
  thirdPartyIdentifier?: string;
  /**
   * Cloudbeds source id identifying Dextr as the booking channel, from
   * `hotel_configurations.dextr_pms_source_id`. This is set by the hotel
   * and can be obtained from the getSources Cloudbeds API
   */
  sourceID?: string;
  /**
   * Stripe customer id. Passed when `paymentMethod === 'credit'` so
   * Cloudbeds can tokenize and retain the card reference.
   */
  cardToken?: string;
  /**
   * Stripe latest_charge id from `payment_intent.succeeded`. Cloudbeds uses
   * this as the authorization code for the initial deposit.
   */
  paymentAuthorizationCode?: string;
  specialRequests?: string;
  sendEmailConfirmation?: boolean;
}

export interface CloudbedsPostReservationUnassignedDailyRate {
  date: string; // YYYY-MM-DD
  rate: number;
  baseRate?: number;
}

export interface CloudbedsPostReservationUnassignedRoom {
  subReservationID: string;
  roomTypeName: string;
  roomTypeID: string;
  adults: number;
  children: number;
  dailyRates: CloudbedsPostReservationUnassignedDailyRate[];
  roomTotal: number;
}

export interface CloudbedsPostReservationResponseData {
  reservationID: string;
  status: 'not_confirmed' | 'confirmed';
  guestID: string;
  guestFirstName: string;
  guestLastName: string;
  guestGender: 'M' | 'F' | 'N/A' | null;
  guestEmail: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  dateCreated: string; // ISO 8601
  grandTotal: number;
  unassigned: CloudbedsPostReservationUnassignedRoom[];
}

/**
 * Raw HTTP response body from `POST /postReservation`.
 *
 * Unlike most Cloudbeds endpoints that nest payload under `data`, this
 * endpoint returns the reservation fields inline alongside `success` and
 * `message`, so the standard `CloudbedsApiEnvelope<T>` wrapper does not apply.
 */
export type CloudbedsPostReservationRawResponse =
  | ({ success: true; message?: null } & CloudbedsPostReservationResponseData)
  | { success: false; message: string };

/** Entry in the `rooms` array of `PUT /putReservation` for modifying accommodations. */
export interface CloudbedsPutReservationRoomEntry {
  subReservationID?: string;
  roomTypeID: string;
  checkinDate: string; // YYYY-MM-DD
  checkoutDate: string; // YYYY-MM-DD
  adults: number;
  children: number;
  rateID?: string;
  /** When true (default), Cloudbeds recalculates pricing on room type change. */
  adjustPrice?: boolean;
}

export interface CloudbedsPutReservationRequest {
  propertyID: string;
  reservationID: string;
  status?: 'confirmed' | 'canceled' | 'no_show' | 'checked_in' | 'checked_out';
  /** Cloudbeds cancellation reason, included when `status === 'canceled'`. */
  reason?: string;
  /** Array of room modifications (dates, room type, occupancy). */
  rooms?: CloudbedsPutReservationRoomEntry[];
}

export interface CloudbedsPutReservationResponseData {
  reservationID: string;
  status: string;
}
