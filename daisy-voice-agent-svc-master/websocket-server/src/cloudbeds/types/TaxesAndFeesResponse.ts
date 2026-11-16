/**
 * `GET /getTaxesAndFees` query and response shapes.
 *
 * Only exclusive taxes/fees with `availableFor` containing "rate" are applied
 * to room-rate quotes. Inclusive taxes are already baked into the rate and
 * should not be added on top.
 */

export type CloudbedsTaxAvailableFor =
  | 'product' // Items
  | 'rate' // Reservations
  | 'fee' // Charged on top of fees
  | 'tax' // Charged on top of other taxes
  | 'custom_item' // Custom items
  | 'payment'; // Payment surcharges

export interface CloudbedsGetTaxesAndFeesQuery {
  propertyID: string;
  /** Filter by entity type — pass "rate" to scope to room-rate taxes. */
  availableFor?: CloudbedsTaxAvailableFor;
  includeDeleted?: boolean;
  includeExpired?: boolean;
  includeCustomItemTaxes?: boolean;
}

export interface CloudbedsTaxOrFee {
  taxID: string;
  feeID?: string;
  name: string;
  code: string;
  /** Numeric string, e.g. "6.57000" for 6.57 %. */
  amount: string;
  amountAdult: string | null;
  amountChild: string | null;
  amountRateBased: unknown[];
  /** How the amount is expressed. */
  amountType:
    | 'percentage' // Percentage of Total Amount
    | 'fixed' // Fixed per Room Night / Item
    | 'fixed_per_person' // Fixed per Person per Night
    | 'fixed_per_accomodation' // Fixed per Accommodation
    | 'fixed_per_reservation' // Fixed per Reservation
    | 'percentage_rate_based'; // Rate-based
  /** Whether the tax/fee is included in the base rate or added on top. */
  inclusiveOrExclusive: 'inclusive' | 'exclusive';
  isDeleted: boolean;
  type: 'tax' | 'fee' | string;
  kind: string | null;
  /** Entity types this tax/fee applies to, e.g. ["rate"], ["product","rate"]. */
  availableFor: CloudbedsTaxAvailableFor[];
  isRoomTypeRestricted: boolean;
  roomTypes: { roomTypeID: string; roomTypeName: string }[];
  feesCharged: string[];
  taxesCharged: string[];
}

/** `/getTaxesAndFees` data array returned inside the Cloudbeds envelope. */
export type CloudbedsGetTaxesAndFeesResponseData = CloudbedsTaxOrFee[];
