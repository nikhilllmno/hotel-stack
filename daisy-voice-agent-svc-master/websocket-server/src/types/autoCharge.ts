export interface AutoChargeProcessingResult {
  booking_id: string;
  hotel_id: string;
  success: boolean;
  amount?: number;
  payment_id?: string;
  error?: string;
}
