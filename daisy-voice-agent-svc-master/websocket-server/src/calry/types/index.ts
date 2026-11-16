/**
 * Calry unified API (`/api/v2/vrs/*`) response and request shapes.
 *
 * Calry fronts many PMSes behind one contract; the upstream system (Oracle
 * Opera for our hotels) is bound to an integration account in the Calry
 * dashboard, so nothing here is Opera-specific.
 *
 * Two shapes recur and are worth calling out:
 * - The envelope is inconsistent. Some endpoints return
 *   `{ success, data, meta }`, others a bare `{ data }`. `success` is
 *   therefore optional and never load-bearing — see `CalryClient.unwrap`.
 * - Guest fields are asymmetric between write and read. Writes take
 *   `guest.firstName / lastName / email / phone / address.postalCode`;
 *   reads return `primaryGuest.nameFirst / nameLast / emails[] /
 *   mobileNumbers[] / addresses.postal_code`.
 */

export * from './payment';

export interface CalryCredentials {
  /** `hotels.business_id` — the Calry property id. */
  propertyId: string;
  apiToken: string;
  workspaceId: string;
  integrationAccountId: string;
  hotelId: string;
}

export interface CalryCursors {
  previous: string;
  current: string;
  next: string;
}

export interface CalryMeta {
  limit: number;
  cursors: CalryCursors;
}

export interface CalryEnvelope<T> {
  success?: boolean;
  data?: T;
  message?: string;
  meta?: CalryMeta;
}

// ========== PROPERTY ==========

export interface CalryAddress {
  line1?: string;
  line2?: string;
  /** snake_case on read; writes use `postalCode`. */
  postal_code?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface CalryPropertyRoomTypeRef {
  id: string;
  name: string;
}

export interface CalryProperty {
  id: string;
  name?: string;
  internalName?: string;
  type?: string;
  address?: CalryAddress;
  currency?: string;
  timeZone?: string;
  roomTypes?: CalryPropertyRoomTypeRef[];
}

// ========== ROOM TYPE ==========

export interface CalryRoomTypeUnit {
  id?: string;
  name?: string;
  description?: string;
  maxOccupancy?: number;
}

/**
 * The field spec documents `units` as `{ count, data[] }`, but sample
 * responses return a bare array. Both are accepted.
 */
export type CalryRoomTypeUnits =
  | CalryRoomTypeUnit[]
  | { count?: number; data?: CalryRoomTypeUnit[] };

export interface CalryBedRoom {
  type?: string;
  count?: number;
  bedsCount?: number;
}

export interface CalryBathRoom {
  type?: string;
  count?: number;
}

export interface CalryCheckIn {
  checkInStart?: string;
  checkInEnd?: string;
}

export interface CalryCheckOut {
  checkOutStart?: string;
  checkOutEnd?: string;
}

export interface CalryRoomType {
  id: string;
  propertyId?: string;
  name?: string;
  description?: string;
  maxOccupancy?: number;
  units?: CalryRoomTypeUnits;
  bedRoom?: CalryBedRoom;
  bathRoom?: CalryBathRoom;
  checkIn?: CalryCheckIn;
  checkOut?: CalryCheckOut;
  minimumNights?: number;
  maximumNights?: number;
}

// ========== AVAILABILITY ==========

export type CalryAvailabilityStatus = 'AVAILABLE' | 'NOT_AVAILABLE';

export interface CalryDateWiseAvailability {
  date: string;
  status: CalryAvailabilityStatus;
  unitsAvailable?: number;
  price?: { amount?: number; currency?: string };
  minimumNights?: number;
  /** Returned as a literal 0 to mean "no maximum" — never treat 0 as a cap. */
  maximumNights?: number;
  reservationIds?: string[];
}

export interface CalryAvailability {
  propertyId: string;
  roomTypeId: string;
  dateWiseAvailability: CalryDateWiseAvailability[];
}

export interface CalryGetAvailabilityQuery {
  startDate: string;
  endDate: string;
  roomTypeId: string;
  rates: boolean;
  realtime?: boolean;
}

// ========== QUOTE ==========

export interface CalryPriceBreakdownEntry {
  name?: string;
  description?: string;
  type?: string;
  total: number;
  isMandatory?: boolean;
}

export interface CalryBasePriceBlock {
  totalBasePrice?: number;
  breakdown?: CalryPriceBreakdownEntry[];
}

export interface CalryFeeBlock {
  totalFee?: number;
  breakdown?: CalryPriceBreakdownEntry[];
}

export interface CalryTaxBlock {
  totalTax?: number;
  breakdown?: CalryPriceBreakdownEntry[];
}

export interface CalryDiscountBlock {
  totalDiscount?: number;
  breakdown?: CalryPriceBreakdownEntry[];
}

export interface CalryRatePlan {
  /**
   * Documented in Calry's field spec but absent from every sample response.
   * Rate plan selection falls back to `name`, then to the first plan.
   */
  ratePlanId?: string | number;
  name?: string;
  /** Includes `deposit` — stay cost is `totalPrice - deposit`. */
  totalPrice: number;
  totalPriceAfterTax?: number;
  /** Security deposit, informational only — Calry cannot collect it. */
  deposit?: number;
  basePrice?: CalryBasePriceBlock;
  fee?: CalryFeeBlock;
  tax?: CalryTaxBlock;
  discount?: CalryDiscountBlock;
}

export interface CalryQuote {
  propertyId: string;
  roomTypeId: string;
  numberOfGuests?: number;
  arrivalDate?: string;
  departureDate?: string;
  currency?: string;
  ratePlans?: CalryRatePlan[];
}

export interface CalryGetQuoteQuery {
  startDate: string;
  endDate: string;
  guests: number;
  roomTypeId: string;
}

// ========== RESERVATION ==========

export interface CalryGuestWrite {
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: {
    line1?: string;
    line2?: string;
    /** camelCase on write; reads return `postal_code`. */
    postalCode?: string;
    city?: string;
    state?: string;
    country?: string;
  };
}

export interface CalryPrimaryGuest {
  name?: string;
  nameFirst?: string;
  nameLast?: string;
  emails?: string[];
  mobileNumbers?: string[];
  addresses?: CalryAddress;
  nationality?: string | null;
}

export interface CalryFinances {
  totalPrice?: number;
  currency?: string;
  totalPaid?: number;
  remainingBalance?: number | null;
  paymentStatus?: string;
  basePrice?: CalryBasePriceBlock;
  fee?: CalryFeeBlock;
  tax?: CalryTaxBlock;
  discount?: CalryDiscountBlock;
}

export interface CalryReservation {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  cancelledAt?: string | null;
  arrivalDate: string;
  departureDate: string;
  nights?: number;
  propertyId?: string;
  unitIds?: string[];
  /** Singular `roomTypeId` on write, array on read. */
  roomTypeIds?: string[];
  numberOfGuests?: number;
  numberOfAdults?: number;
  numberOfChildren?: number;
  numberOfInfants?: number;
  numberOfPets?: number;
  primaryGuest?: CalryPrimaryGuest;
  source?: string;
  totalPrice?: number;
  currency?: string;
  /** Case-inconsistent upstream: CONFIRMED / confirmed / CANCELLED / new. */
  status?: string;
  arrivalEstimatedTime?: string;
  departureEstimatedTime?: string;
  notes?: string | null;
  comments?: string | null;
  codes?: { accessCode?: string[] };
  /**
   * Omitted from list responses unless `include=true`. Prefer
   * `finances.totalPrice` over `finances.basePrice.totalBasePrice`, which
   * double-counts a "Total price from channel" line on some PMSes.
   */
  finances?: CalryFinances;
}

export interface CalryCreateReservationRequest {
  propertyId: string;
  roomTypeId: string;
  arrivalDate: string;
  departureDate: string;
  guest?: CalryGuestWrite;
  status?: string;
  numberOfGuests?: number;
  numberOfAdults?: number;
  numberOfChildren?: number;
  numberOfInfants?: number;
  numberOfPets?: number;
  totalPrice?: number;
  currency?: string;
  notes?: string;
  comments?: string;
}

/**
 * Cancellation is not a separate endpoint — it is this request with
 * `status: 'CANCELLED'`. `propertyId`, `roomTypeId` and price are not
 * updatable, so room moves and repricing are impossible.
 */
export interface CalryUpdateReservationRequest {
  reservationId: string;
  arrivalDate?: string;
  departureDate?: string;
  guest?: CalryGuestWrite;
  numberOfGuests?: number;
  numberOfAdults?: number;
  numberOfChildren?: number;
  numberOfInfants?: number;
  numberOfPets?: number;
  status?: string;
  notes?: string;
  comments?: string;
  codes?: { accessCode?: string[] };
}

export interface CalryListReservationsQuery {
  realtime?: boolean;
  status?: string;
  arrivalStartDate?: string;
  arrivalEndDate?: string;
  departureStartDate?: string;
  departureEndDate?: string;
  /** Includes the `finances` block, which list responses otherwise omit. */
  include?: boolean;
}

/**
 * Body of `POST /api/v2/vrs/passthrough` — a raw call to the upstream PMS,
 * used for endpoints Calry has not unified yet (Opera availability).
 * Calry injects the upstream auth; everything else is ours to supply.
 */
export interface CalryPassthroughRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Full upstream URL; `{placeholders}` are filled from `data.pathParams`. */
  sourceUrl: string;
  data?: {
    queryParams?: Record<string, string | number | boolean>;
    pathParams?: Record<string, string>;
    headers?: Record<string, string>;
    body?: unknown;
  };
}

/** Where the Opera passthrough calls for a hotel are addressed. */
export interface OperaTarget {
  /** Opera Cloud host, e.g. `https://<host>.hospitality-api.<region>.ocs.oraclecloud.com`. */
  host: string;
  /** Opera property code, sent both as `x-hotelid` and in the path. */
  propertyCode: string;
}

/** One room type from Opera's `resortRoomTypes` list of values. */
export interface OperaRoomTypeLov {
  code: string;
  name?: string;
  description?: string;
  active?: boolean;
}

export interface OperaListOfValuesResponse {
  listOfValues?: { items?: OperaRoomTypeLov[] };
}

/** One entry of Opera `GET /rtp/v1/hotels/{hotelId}/ratePlans`. */
export interface OperaRatePlan {
  ratePlanCode: string;
  roomTypeList?: { code: string; description?: string }[];
}

export interface OperaRatePlansResponse {
  ratePlans?: OperaRatePlan[];
}

/** `GET /par/v1/hotels/{hotelId}/availability/alternate` — per-date status. */
export interface OperaAlternateAvailabilityResponse {
  alternates?: { date: string; status: string }[];
}

/**
 * `GET /rsv/v1/hotels/{hotelId}/reservations/rateInfo` with
 * `summaryInfo=true` — prices a hypothetical stay without booking it.
 * `gross` is the stay before tax and `net` includes it.
 */
export interface OperaRateInfoResponse {
  summary?: {
    details?: {
      summaryDate: string;
      revenue?: number;
      package?: number;
      tax?: number;
      gross?: number;
      net?: number;
      ratePlanCode?: string;
      currencyCode?: string;
    }[];
    gross?: number;
    net?: number;
    currencyCode?: string;
    hasSuppressedRate?: boolean;
  };
}

/** Opera reports a date as sellable only when its status is exactly this. */
export const OPERA_STATUS_AVAILABLE = 'Available';

/** Opera `GET /par/v1/hotels/{hotelId}/availability` query parameters. */
export interface OperaAvailabilityQuery {
  roomStayStartDate: string;
  roomStayEndDate: string;
  adults: number;
  children: number;
  roomStayQuantity: number;
  limit?: number;
  roomType?: string;
  ratePlanCode?: string;
  ratePlanInfo?: boolean;
  includeClosedRates?: boolean;
}

// ========== DAISY-FACING SHAPES ==========

export interface CalryRoomInfo {
  room_id: string;
  room_name: string;
  description?: string;
  max_occupancy?: number;
}

export interface CalryRoomsInfo {
  rooms: CalryRoomInfo[];
  note: string;
}

export interface CalryRoomGroup {
  room_id: string;
  room_name: string;
  available_units: number;
  deposit_rule_info: Record<string, never>;
  cancel_rule_info: Record<string, never>;
  pricing: import('../../pms/types/Quote').PMSQuote;
  raw_response: CalryQuote;
}

export interface CalryAvailabilityResponse {
  groups: CalryRoomGroup[];
  discount: null;
  date_correction_details?: string;
}

/**
 * Adapter passed to the shared pet fee strategies. Calry has no addon or
 * product concept, so pet fees are always priced locally from
 * `hotel_configurations.pet_fee_configuration`.
 */
export interface CalryPetFeeQuote {
  check_in: string;
  check_out: string;
  unit_group_id: string;
  base_rate: number;
  taxes: number;
  fees: number;
  total_amount: number;
  amountCharged: number;
}

export const CALRY_STATUS_CONFIRMED = 'confirmed';
export const CALRY_STATUS_CANCELLED = 'CANCELLED';
