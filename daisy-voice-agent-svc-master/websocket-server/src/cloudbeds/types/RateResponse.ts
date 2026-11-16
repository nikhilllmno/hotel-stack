/**
 * `GET /getRate?...&detailedRates=true` response shapes.
 *
 * Cloudbeds v1.3 does not itemize taxes or fees in the rate endpoint —
 * only an aggregate `totalRate`. The integration derives a taxes value as
 * `max(0, totalRate - sum(roomRateDetailed.rate))`. Callers must persist
 * the full response in `quote_object.raw_response` for audit.
 */

export interface CloudbedsRateDetailed {
  date: string;
  rate: number;
  totalRate: number;
  roomsAvailable: number;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  minLos: number;
  maxLos: number;
}

export interface CloudbedsRate {
  rateID: string;
  isDerived: boolean;
  roomRate: number;
  totalRate: number;
  roomsAvailable: number;
  daysOfWeek: string[] | null;
  roomRateDetailed: CloudbedsRateDetailed[] | null;
}

/** Cloudbeds `GET /getRate` returns a single rate object for the queried room type. */
export type CloudbedsGetRateResponseData = CloudbedsRate;
