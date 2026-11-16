import { PlatformPricing } from '../../../types/reservation';
import { RateForDateList } from './common';

export interface GetQuoteResponse {
  pricing_type?: string;
  rate_adjustment?: string;
  check_in: string;
  check_out: string;
  num_adults?: number;
  num_children?: number;
  available?: string;
  unit_group_id: number;
  booking_link?: string;
  occupancy?: number;
  rate_for_date_list?: RateForDateList[];
  response_errors?: string[];
  platform_pricing?: PlatformPricing | null;
  base_rate: number;
  currency?: string;
  taxes: number;
  fees: number;
  total_amount: number;
  amountCharged: number;
}

export interface GetLowestRateResponse {
  pricing_type: string;
  check_in: string;
  check_out: string;
  available: string;
  base_rate?: number;
  taxes?: number;
  fees?: number;
  amountCharged?: number;
  unit_group_id?: number;
  booking_link?: string;
  currency?: string;
  occupancy?: number;
  num_adults: number;
  num_children: number;
  rate_for_date_list?: RateForDateList[];
  response_errors: string[];
}
