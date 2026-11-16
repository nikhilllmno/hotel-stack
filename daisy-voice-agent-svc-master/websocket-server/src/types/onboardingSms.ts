export interface OnboardingSmsResult {
  hotel_id: string;
  hotel_name: string;
  reservations_processed: number;
  sms_sent: number;
  errors: Array<{
    reservation_id: string;
    error: string;
  }>;
}
