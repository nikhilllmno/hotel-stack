export interface BookingSummaryV2 {
  reservations: {
    total: number;
    total_revenue: number;
    total_amount_collected: number;
    total_review_pending_reservations: number;
  };
}

export interface BookingSummaryV1 {
  reservations: {
    total: number;
    total_revenue: number;
  };
}

export interface ReservationDashboardSummaryV2 {
  total_reservations: number;
  total_amount: number;
  total_amount_collected: number;
  total_review_pending_reservations: number;
}
export interface ReservationDashboardSummaryV1 {
  total_reservations: number;
  total_amount: number;
}
