export interface BookingReview {
  id: string;
  reservation_review_id: string;
  /** (e.g. BK12345). For multi-room bookings, this is the shared prefix — individual reservations are BK12345_1, BK12345_2, etc. For single-room bookings, this is the same as the booking ID. */
  booking_id: string;
  hotel_id: string;
  created_at: Date;
}
