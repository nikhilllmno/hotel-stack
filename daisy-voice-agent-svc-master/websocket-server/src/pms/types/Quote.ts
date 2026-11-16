/**
 * Common quote interface that all PMS providers must return
 * Each PMS can extend this with their own specific fields
 */
export interface PMSQuote {
  /** Base rate before taxes and fees */
  base_rate: number;

  /** Tax amount */
  taxes: number;

  /** Fees amount */
  fees: number;

  /** Total amount (base_rate + taxes + fees) */
  total_amount: number;

  /** Amount to be charged as deposit (can be same as total_amount or partial) */
  amountCharged: number;

  /** Currency code (e.g., 'USD', 'EUR') */
  currency?: string;

  /** Response returned by the PMS API */
  raw_response?: any;

  /** Raw quote response which was then updated by Dextr */
  quote_modified_by_dextr?: any;

  /** Rate code associated with this quote (StayNTouch only). Persisted to the reservation table. */
  rate_code?: string | null;

  /** Rate identifier (Mews: rate GUID; StayNTouch: numeric rate ID). Not for display — use rate_code for that. */
  rate_id?: string | number | null;

  /** Mews pet Product GUID, set when the hotel's pet fee was priced via a Mews Product instead of the Daisy DB pet fee config. */
  pet_product_id?: string;

  /** Count to pass as ProductOrders[].Count when attaching pet_product_id to the reservation. */
  pet_product_count?: number;

  /** Any PMS-specific fields can be added by extending this interface */
  [key: string]: any;
}
