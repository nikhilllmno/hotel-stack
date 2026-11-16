export interface CancelReservationRequest {
  reason?: string;
  send_cancellation_email?: boolean;
  refund_deposit?: boolean;
  charge_penalty?: boolean;
}
