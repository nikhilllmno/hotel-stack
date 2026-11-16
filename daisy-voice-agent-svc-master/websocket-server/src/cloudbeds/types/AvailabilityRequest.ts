/**
 * Typed query parameter shapes for the Cloudbeds read endpoints.
 *
 * These mirror the query strings used by the availability / rate / rooms
 * calls and are used by both the HTTP client and the Joi validators.
 */

export interface CloudbedsGetRoomsQuery {
  propertyIDs: string;
}

/** Full availability query — requires dates and occupancy. */
export interface CloudbedsGetRoomTypesQuery {
  propertyIDs: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  adults: number;
  children: number;
}

export interface CloudbedsGetRateQuery {
  propertyID: string;
  roomTypeID: string;
  startDate: string;
  endDate: string;
  adults: number;
  children: number;
  /** Always passed as `true` to request per-night breakdown. */
  detailedRates: boolean;
}
