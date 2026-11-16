import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { GetQuoteResponse } from '../../resNexus/model/response/quote';
import { Discount } from '../Discount';
type QuoteResponse = Omit<
  GetQuoteResponse,
  | 'booking_link'
  | 'pricing_type'
  | 'rate_adjustment'
  | 'available'
  | 'occupancy'
  | 'rate_for_date_list'
  | 'response_errors'
>;

interface relevantGroupInfo {
  unit_group_id: number;
  room_id: number;
  unit_group_name: string;
  number_of_units_available: number;
  business_id: number | string;
}

export type GroupWithQuote = relevantGroupInfo & QuoteResponse;

export type GroupDescription = Record<string, string>;

export interface GetAvailabilityResponse {
  groups: GroupWithQuote[] | GroupDescription[];
  discount: Omit<
    Discount,
    | 'reservation_id'
    | 'created_at'
    | 'updated_at'
    | 'id'
    | 'hotel_id'
    | 'deleted_at'
    | 'phone_number'
    | 'tax_rate'
  > | null;
}

export interface GetPaymentStatusResponse {
  booking_id: string;
  status: ReservationStatus;
  payment_id?: string;
  check_in?: string;
  check_out?: string;
}

export interface CancellationResponse {
  booking_id: string;
  status: string;
  response_errors: string[];
}

export interface SisterPropertyAvailabilityResult {
  hotel_name: string;
  hotel_phone_number?: string;
  website?: string;
  distance_miles?: number;
  available: boolean;
  groups?: GroupWithQuote[] | GroupDescription[];
  /** The sister hotel's PMS moved the dates (e.g. a past check-in); the agent must say so. */
  date_correction_details?: string;
  error?: string;
}

export interface CrossSellAvailabilityResponse {
  cross_sell_available: boolean;
  results: SisterPropertyAvailabilityResult[];
  message: string;
}
