import { GetReservationResponse } from './GetReservationResponse';

export interface SearchReservationsResponse {
  results: GetReservationResponse[];
  total_count?: number;
}

export type SearchReservationsParams = (
  | { confirmation_number: string }
  | { alt_confirmation_number: string }
  | { reservation_id: string }
  | { mobile_number: string }
  | { home_phone: string }
  | { query: string }
  | { last_name: string }
) & {
  page?: number;
  per_page?: number;
  date?: string;
  date_filter?: 'arrival' | 'departure' | 'created' | 'updated';
  date_operator?: 'eq' | 'gte' | 'lte';
};
