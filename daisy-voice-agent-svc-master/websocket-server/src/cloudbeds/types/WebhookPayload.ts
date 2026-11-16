/**
 * Cloudbeds webhook payload types.
 *
 * Cloudbeds webhooks POST minimal JSON payloads to our endpoint.
 * Full reservation details must be fetched via getReservation.
 *
 * `propertyID`/`propertyId` arrive on the wire as a JSON number (hence the
 * `number` half of the union below), which risks precision loss for property
 * IDs on newer Cloudbeds "islands" whose IDs exceed Number.MAX_SAFE_INTEGER.
 * `propertyID_str`/`propertyId_str` carry the same value as a string and
 * should be preferred wherever present.
 */

export interface CloudbedsWebhookBasePayload {
  version: string;
  timestamp: number;
  event: string;
}

export interface CloudbedsReservationCreatedPayload extends CloudbedsWebhookBasePayload {
  propertyID: string | number;
  propertyID_str?: string;
  reservationID: string;
  startDate: string;
  endDate: string;
}

export interface CloudbedsReservationStatusChangedPayload extends CloudbedsWebhookBasePayload {
  propertyID: string | number;
  propertyID_str?: string;
  reservationID: string;
  status: string;
}

export interface CloudbedsReservationModifiedPayload extends CloudbedsWebhookBasePayload {
  propertyId: string | number;
  propertyId_str?: string;
  reservationId: string;
}

export interface CloudbedsAppStateChangedPayload extends CloudbedsWebhookBasePayload {
  propertyID: string | number;
  propertyID_str?: string;
  clientID: string;
  oldState: string;
  newState: string;
}

export interface CloudbedsWebhookResponse {
  success: boolean;
  message: string;
  reservation_id?: string;
}
