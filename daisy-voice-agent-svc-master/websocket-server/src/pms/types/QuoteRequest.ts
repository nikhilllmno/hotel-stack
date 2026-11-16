/**
 * PMS-agnostic quote request parameters
 * This interface uses generic field names that work across different PMS providers
 */
export interface PMSQuoteRequest {
  /** Business/Property ID */
  business_id: string;

  /** Room ID (unit_group_id in ResNexus, room_type_id in Cloudbeds, ResourceCategoryId UUID in Mews, etc.) */
  room_id: number | string;

  /** Check-in date (YYYY-MM-DD format) */
  check_in: string;

  /** Check-out date (YYYY-MM-DD format) */
  check_out: string;

  /** Number of adults */
  num_adults: number;

  /** Number of children (optional) */
  num_children?: number;

  /** Hotel ID for applying hotel-specific business logic */
  hotel_id: string;

  /** Caller's phone number for discount lookup */
  caller_phone_num: string;

  /** Number of pets */
  num_pets: number;

  /** Rate code to use for pricing (e.g. "BAR", "CORP"). When provided, the quote
   *  must be fetched for exactly this rate code rather than the first allowed match. */
  rate_code?: string;
}
