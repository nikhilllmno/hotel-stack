/**
 * `GET /getItems` query and response shapes.
 *
 * Items represent ancillary charges (services, products) that can be added to
 * a reservation. The pet fee is exposed here as a service item.
 */

export interface CloudbedsGetItemsQuery {
  propertyID: string;
}

export interface CloudbedsItemTax {
  taxName: string | null;
  taxValue: number | null;
  totalTaxes: number | null;
}

export interface CloudbedsItemFee {
  feeName: string | null;
  feeValue: number | null;
  totalFees: number | null;
}

export interface CloudbedsItem {
  itemID: string;
  itemType: 'product' | 'service' | 'mealplan' | string;
  sku: string;
  itemCode: string;
  name: string;
  /** Null when unset. */
  categoryID: string | null;
  /** Empty string when unset. */
  categoryName: string;
  description: string;
  /** Base unit price of the item. */
  price: number;
  stockInventory: boolean;
  /** Current stock level. Null when `stockInventory` is false. */
  itemQuantity: number | null;
  /** Quantity at which to trigger a reorder alert. */
  reorderThreshold: number | null;
  /** Whether the item is at or below the reorder threshold. */
  reorderNeeded: boolean | null;
  /** Quantity at which to stop selling the item. */
  stopSell: number | null;
  /** Whether the item is at or below the stop-sell threshold. */
  stopSellMet: boolean | null;
  /** Taxes applicable to this item. */
  taxes: CloudbedsItemTax[] | null;
  /** Fees applicable to this item. */
  fees: CloudbedsItemFee[] | null;
  /** `price` minus any included (inclusive) taxes. */
  priceWithoutFeesAndTaxes: number | null;
  /** `price` plus all applicable fees and taxes. */
  grandTotal: number | null;
}

/** `/getItems` data array returned inside the Cloudbeds envelope. */
export type CloudbedsGetItemsResponseData = CloudbedsItem[];

/**
 * `POST /postItem` request body.
 * Adds an item (product/service) to an existing reservation.
 * https://developers.cloudbeds.com/reference/post_postitem-2
 */
export interface CloudbedsPostItemRequest {
  propertyID: string;
  /** Required when targeting a reservation (vs. house account). */
  reservationID: string;
  /** Identifier of the item to post. */
  itemID: string;
  /** Number of units to post. */
  itemQuantity: number;
  /**
   * Override the item's registered price per unit.
   * When omitted, Cloudbeds uses the item's stored price.
   */
  itemPrice?: string;
  /** Free-text note attached to the item transaction. */
  itemNote?: string;
}

/** Response data returned inside the Cloudbeds envelope for `POST /postItem`. */
export interface CloudbedsPostItemResponseData {
  soldProductID: string;
  transactionID: string;
  transactionStatus: string | null;
  remainingItemQuantity: number | null;
  reorderNeeded: boolean | null;
  stopSellMet: boolean | null;
}

/** Minimal quote shape passed to `PetFeeStrategy.calculatePetFee` for Cloudbeds. */
export interface CloudbedsPetFeeQuote {
  check_in: string;
  check_out: string;
  unit_group_id: string;
  base_rate: number;
  taxes: number;
  fees: number;
  total_amount: number;
  amountCharged: number;
}
