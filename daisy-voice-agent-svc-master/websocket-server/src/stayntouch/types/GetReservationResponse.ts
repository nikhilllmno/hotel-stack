import { ReservationSource } from '../../dtos/enum/ReservationSource';

export interface GetReservationStayDateResponse {
  date: string;
  id: number;
  amount: string;
  net_amount: string;
  tax_amount: string;
  exclusive_tax_amount: string;
  inclusive_tax_amount: string;
  rate_id: number;
  rate_suppressed: boolean;
  room_type_id: number;
  adults: number;
  children: number;
  infants: number;
}

export interface GetReservationGuestResponse {
  id: number;
  is_primary: boolean;
  is_child: boolean;
  is_infant: boolean;
  first_name: string;
  last_name: string;
  email: string;
  is_vip: boolean;
  mobile_phone: string;
  home_phone?: string;
  opted_promotional_emails: boolean;
  is_flagged: boolean;
  address?: {
    id: number;
    address_line1?: string;
    address_line2?: string;
    city: string;
    state: string;
    postal_code: string;
    country_code: string;
  };
  billing_address?: {
    id?: number;
    secondary_email?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country_code?: string;
  };
}

export interface GetReservationResponse {
  id: number;
  hotel_id: number;
  confirmation_number: string;
  currency_code: string;
  status: string;
  arrival_date: string;
  arrival_time: string;
  departure_date: string;
  departure_time: string;
  booking_origin_code: string;
  booker_email: string;
  created_time: string;
  updated_time: string;
  deposit_amount: number;
  market_segment_code: string;
  promotion_code: string;
  segment_code: string;
  source_code: string;
  purpose_of_stay_code: string;
  tax_exempt: boolean;
  upsell_applied: boolean;
  early_check_in_applied: boolean;
  late_check_out_applied: boolean;
  restrict_post: boolean;
  do_not_move: boolean;
  bills?: GetReservationBillResponse[];
  stay_dates?: GetReservationStayDateResponse[];
  guests?: GetReservationGuestResponse[];
  addons?: GetReservationAddonResponse[];
  notes?: GetReservationNoteResponse[];
  creator?: {
    id: number;
    login: string;
  };
  wake_up?: Record<string, any>;
  reservation_source?: ReservationSource;
}

export interface GetReservationBillTransactionResponse {
  id: number;
  bill_id: number;
  amount: number;
  charge_code?: string;
  charge_group?: string;
  charge_code_type?: string;
  currency_code: string;
  date?: string;
  payment_type?: string;
  post_stay?: boolean;
  reference_number?: string;
  reference_text?: string;
}

export interface GetReservationBillResponse {
  bill_number: number;
  id: number;
  invoice_number: string;
  entity_id: number;
  entity_type: string;
  entity_name: string;
  reservation_id: number;
  transactions?: GetReservationBillTransactionResponse[];
}

export interface GetReservationAddonResponse {
  id: number;
  name: string;
  description?: string;
  amount: number;
  amount_type?: string;
  post_type?: string;
  post_type_description?: string;
  post_days?: string[];
  charge_code_id?: number;
  charge_group_id?: number;
  currency_code?: string;
  online?: boolean;
  image_url?: string;
  quantity?: number;
  included_in_rate?: boolean;
}

export interface GetReservationNoteResponse {
  id?: number;
  text?: string;
  note?: string;
  category?: string;
  created_time?: string;
  updated_time?: string;
  [key: string]: any;
}
