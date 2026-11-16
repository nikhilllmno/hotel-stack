/**
 * Response shape for Cloudbeds `GET /getReservation`.
 * https://developers.cloudbeds.com/reference/get_getreservation-2
 */

export interface CloudbedsGetReservationQuery {
  propertyID: string;
  reservationID: string;
}

export interface CloudbedsGetReservationsBySourceQuery {
  propertyID: string;
  sourceReservationId: string;
  includeGuestsDetails?: boolean;
}

export interface CloudbedsGetReservationsByGuestNameQuery {
  propertyID: string;
  firstName?: string;
  lastName?: string;
  /** YYYY-MM-DD; only reservations checking in on or after this date. */
  checkInFrom?: string;
  /** YYYY-MM-DD; only reservations checking in on or before this date. */
  checkInTo?: string;
  includeGuestsDetails?: boolean;
}

/** One page of every reservation checking in between two dates. */
export interface CloudbedsGetReservationsByCheckInDateQuery {
  propertyID: string;
  /** YYYY-MM-DD; only reservations checking in on or after this date. */
  checkInFrom: string;
  /** YYYY-MM-DD; only reservations checking in on or before this date. */
  checkInTo: string;
  /** YYYY-MM-DD; only reservations checking out on or after this date. */
  checkOutFrom?: string;
  includeGuestsDetails?: boolean;
  /** 1-based. */
  pageNumber: number;
  /** At most 100. */
  pageSize: number;
}

export interface CloudbedsReservationsPage {
  reservations: CloudbedsGetReservationResponseData[];
  /** How many reservations match across every page; null when Cloudbeds didn't say. */
  total: number | null;
}

export interface CloudbedsGetReservationGuestCustomField {
  customFieldID?: string;
  shortcode?: string;
  isActive?: boolean;
  customFieldName?: string;
  customFieldValue?: string;
}

export interface CloudbedsGetReservationGuestRoom {
  reservationRoomID?: string;
  roomID?: string;
  roomName?: string;
  roomTypeName?: string;
  roomTypeIsVirtual?: boolean;
  subReservationID?: string;
}

export interface CloudbedsGetReservationGuestEntry {
  guestID?: string;
  guestFirstName?: string;
  guestLastName?: string;
  guestEmail?: string;
  guestPhone?: string;
  guestCellPhone?: string;
  guestAddress?: string;
  guestCity?: string;
  guestState?: string;
  guestCountry?: string;
  guestZip?: string;
  guestStatus?: string;
  isMainGuest?: boolean;
  roomTypeName?: string;
  roomTypeID?: string;
  roomName?: string;
  rooms?: CloudbedsGetReservationGuestRoom[];
  customFields?: CloudbedsGetReservationGuestCustomField[];
}

export interface CloudbedsGetReservationDailyRate {
  date: string;
  rate: number;
}

export interface CloudbedsGetReservationAssignedRoom {
  reservationRoomID?: string;
  roomTypeName?: string;
  roomTypeNameShort?: string;
  roomTypeIsVirtual?: boolean;
  roomTypeID?: string;
  subReservationID?: string;
  roomName?: string;
  roomID?: string;
  startDate?: string;
  endDate?: string;
  adults?: string;
  children?: string;
  dailyRates?: CloudbedsGetReservationDailyRate[];
  roomTotal?: string;
}

export interface CloudbedsGetReservationBalanceDetailed {
  suggestedDeposit?: string;
  subTotal?: number;
  additionalItems?: number;
  taxesFees?: number;
  grandTotal?: number;
  paid?: number;
}

export interface CloudbedsGetReservationResponseData {
  propertyID?: string;
  guestName?: string;
  guestEmail?: string;
  guestList?: Record<string, CloudbedsGetReservationGuestEntry>;
  reservationID: string;
  dateCreated?: string;
  dateModified?: string;
  source?: string;
  // /getReservations (list) returns the source label as `sourceName`; the
  // singular /getReservation detail endpoint returns it as `source`.
  sourceName?: string;
  sourceID?: string;
  thirdPartyIdentifier?: string;
  status?: string;
  total?: number;
  balance?: number;
  balanceDetailed?: CloudbedsGetReservationBalanceDetailed;
  assigned?: CloudbedsGetReservationAssignedRoom[];
  unassigned?: CloudbedsGetReservationAssignedRoom[];
  /** Reservation-level custom fields (not guest-level). */
  customFields?: CloudbedsGetReservationGuestCustomField[];
  startDate?: string;
  endDate?: string;
  origin?: string;
}
