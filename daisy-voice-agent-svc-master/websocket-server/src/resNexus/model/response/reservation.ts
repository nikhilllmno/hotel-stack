import { Customer } from './common';

export interface CreateReservationResponse {
  action: number;
  business_id: number;
  check_in: string;
  check_out: string;
  unit_group_id?: number;
  units_to_reserve: number;
  num_adults: number;
  num_children: number;
  external_id?: string;
  reservation_id?: string;
  quote: Quote;
  customer: Customer;
  status: number;
  status_value: string;
  notes_from_partner?: string;
  response_errors: string[];
}

export interface Quote {
  pricing_type: string;
  check_in: string;
  check_out: string;
  available: string;
  base_rate: number;
  taxes: number;
  fees: number;
  amountCharged: number;
  unit_group_id: number;
  booking_link: string;
  currency: string;
  occupancy: number;
  num_adults: number;
  num_children: number;
  rate_for_date_list: RateForDateList[];
  response_errors: string[];
}

export interface RateForDateList {
  Rate: number;
  ResDate: string;
}

export interface CancelReservationResponse {
  action: number;
  business_id: number;
  check_in: string;
  check_out: string;
  unit_group_id?: number;
  units_to_reserve: number;
  num_adults: number;
  num_children: number;
  external_id: string;
  reservation_id: string;
  quote?: string;
  customer?: string;
  status: number;
  status_value: string;
  notes_from_partner?: string;
  response_errors: any[];
}

export interface ModifyReservationResponse {
  action: number;
  business_id: number;
  check_in: string;
  check_out: string;
  unit_group_id?: number;
  units_to_reserve: number;
  num_adults: number;
  num_children: number;
  external_id: string;
  reservation_id?: string;
  quote?: string;
  customer: Customer;
  status: number;
  status_value: string;
  notes_from_partner?: string;
  response_errors: any[];
}

export interface CalendarResponse {
  business_id: number;
  calendars: CalendarUnitGroup[];
  response_errors: string[];
}

export interface CalendarUnitGroup {
  unit_group_id: number;
  currency: string;
  data: CalendarDayData[];
  multi_unit: {
    total_units: number;
    unit_ids: string[];
  };
}

export interface CalendarDayData {
  start_date: string;
  end_date: string;
  price: number;
  available_units: number;
  booked_units: number;
  blocked_units: number;
  adults_included_in_rate: number;
  extra_adult_rate: number | null;
  min_stay: number;
}
