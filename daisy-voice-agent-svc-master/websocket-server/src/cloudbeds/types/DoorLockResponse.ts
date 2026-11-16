/**
 * Response shape for Cloudbeds Door Lock API `GET /doorlock/v1/keys/{propertyId}`.
 * https://developers.cloudbeds.com/reference/doorlockkeycontrollerindex-1
 */

export interface CloudbedsDoorLockKeyQuery {
  propertyId: string;
  reservationId?: string;
  subReservationId?: string;
}

export interface CloudbedsDoorLockKey {
  keyId: string;
  propertyId: string;
  reservationId: string;
  subReservationId: string;
  issuerId: string;
  guestId?: string | null;
  rooms: string[];
  commonRooms: string[];
  startDateTime: string;
  endDateTime: string;
  encoder?: string | null;
  keyCode?: string | null;
  keyType: string;
  mobileId?: string | null;
  externalId?: string | null;
  status: string;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface CloudbedsDoorLockKeysResponse {
  data: CloudbedsDoorLockKey[] | null;
}
