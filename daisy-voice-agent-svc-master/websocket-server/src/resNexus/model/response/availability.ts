import { RateForDateList } from './common';

export interface GetAvailabilityResponse {
  groups?: Group[];
  response_errors: string[];
}

export interface Group {
  unit_group_id: number;
  unit_group_name: string;
  number_of_units_available: number;
  business_id: number;
  start_date: string;
  end_date: string;
  num_adults?: number;
  num_children?: number;
  rate?: number;
  taxes?: number;
  fees?: number;
  amountCharged?: number;
  rate_for_date_list?: RateForDateList[];
}
