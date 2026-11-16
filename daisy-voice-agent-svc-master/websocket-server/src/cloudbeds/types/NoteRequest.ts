/**
 * Request / response shapes for Cloudbeds' reservation note endpoints.
 * https://developers.cloudbeds.com/reference/post_postreservationnote-2
 */

// ─── POST /postReservationNote ───────────────────────────────────────────────

export interface CloudbedsPostReservationNoteRequest {
  propertyID: string;
  reservationID: string;
  reservationNote: string;
  userID?: string;
  /** ISO 8601 datetime */
  dateCreated?: string;
}

export interface CloudbedsPostReservationNoteResponseData {
  reservationNoteID: string;
}

/**
 * Raw HTTP response body from `POST /postReservationNote`.
 *
 * Like `postPayment`, this endpoint returns a flat envelope — payload fields
 * sit alongside `success` and `message` at the top level.
 */
export type CloudbedsPostReservationNoteRawResponse =
  | ({
      success: true;
      message?: null;
    } & CloudbedsPostReservationNoteResponseData)
  | { success: false; message: string };
