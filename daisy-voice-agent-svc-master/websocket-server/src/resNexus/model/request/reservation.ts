import { GetQuoteResponse } from '../response/quote';
import { CardFields, Customer } from './common';

export interface CreateReservationRequest {
  business_id: number;
  check_in: string;
  check_out: string;
  unit_group_id: number;
  num_adults: string;
  num_children?: string;
  customer: Customer;
  external_id: string;
  notes_from_partner?: string;
  quote?: GetQuoteResponse;
}

export type CreateReservationWithCardRequest = CreateReservationRequest &
  CardFields;

export interface CancelReservationRequest {
  business_id: number;
  external_id: string;
}

export interface CancelReservationRequestDto {
  business_id: number;
  internal_id: string;
}

export interface ModifyReservationRequest {
  business_id?: number;
  check_in?: string;
  check_out?: string;
  num_adults?: string;
  num_children?: string;
  customer?: Customer;
  external_id?: string;
  card_number?: string;
  expire_month?: string;
  expire_year?: string;
  card_cvv?: string;
  unit_group_id?: number;
  quote?: GetQuoteResponse;
  notes_from_partner?: string;
}
