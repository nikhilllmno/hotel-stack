/** Raw counts returned by SessionRepository.getKpiSummary() */
export interface KpiRawCounts {
  total_calls: number;
  meaningful_calls: number;
  booking_intent_calls: number;
  booking_intent_conversions: number;
  total_conversions: number;
  total_escalated: number;
  resolved_meaningful: number;
  forwarded_calls: number;
  resolved_meaningful_fwd: number;
  new_reservation_escalated: number;
  new_reservation_calls: number;
  room_nights: number;
  total_revenue: number;
}

/** KPI summary card values for GET /api/sessions/kpis */
export interface CallKpiSummary {
  conversion_booking_intent: number; // % — NEW_RESERVATION calls that converted / NEW_RESERVATION calls
  conversion_all_calls: number; // % — calls with ≥1 booking / total calls
  resolution_rate_meaningful_intent: number; // % — resolved meaningful / meaningful calls
  resolution_rate_all_calls: number; // % — non-escalated calls / total calls
  resolution_rate_meaningful_forwarding: number; // % — non-forwarded meaningful / meaningful calls
  resolution_rate_all_forwarding: number; // % — non-forwarded calls / total calls
  agent_adr: number; // $ — total revenue / room nights
  escalation_rate: number; // % — escalated / total calls
  escalation_rate_forwarding: number; // % — call-forwarded / total calls
  room_nights: number; // count
  forwarded_calls: number; // count — calls with call_forwarded metadata
  booking_intent_calls: number; // count — NEW_RESERVATION intent calls
}

/** One data point in a trend series */
export interface KpiTrendPoint {
  date: string; // "2026-06-09"
  value: number; // 0–100 for percent; dollar amount for currency
  num_of_calls: number; // total CALL sessions for that hotel-local day (for tooltip)
  /** Raw count for the metric numerator (percent series only; sum across days for weekly aggregation) */
  numerator?: number;
  /** Raw count for the metric denominator (percent series only; sum across days for weekly aggregation) */
  denominator?: number;
}

/** One named series for a chart (two per graph to support toggles) */
export interface KpiTrendSeries {
  metric: string;
  label: string;
  unit: 'percent' | 'currency';
  data: KpiTrendPoint[];
}

/** GET /api/sessions/kpis/trend — chart series (2 revenue + 2 resolution + 2 conversion) */
export type KpiTrendResponse = KpiTrendSeries[];

/** Raw row from getKpiTrendRates() DB query */
export interface KpiTrendRateRow {
  day: string;
  total_calls: number;
  meaningful_calls: number;
  new_reservation_calls: number;
  escalated_calls: number;
  forwarded_calls: number;
  resolved_meaningful_calls: number;
  resolved_meaningful_fwd_calls: number;
  resolved_new_reservation_calls: number;
}

/** Raw row from getKpiTrendRevenue() DB query */
export interface KpiTrendRevenueRow {
  day: string;
  converted_calls: number;
  booking_intent_conversions: number;
  room_nights: number;
  total_revenue: number;
  advance_collected: number;
}
