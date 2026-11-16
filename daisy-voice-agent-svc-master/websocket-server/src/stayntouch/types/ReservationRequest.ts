export interface ReservationStayDate {
  date: string;
  rate_id: string;
  room_type_id: string;
  adults: number;
  children: number;
  amount?: number;
}

export interface ReservationGuest {
  first_name: string;
  last_name: string;
  email: string;
  address?: ReservationGuestAddress;
  mobile_phone: string;
  is_primary: boolean;
}

export interface ReservationGuestAddress {
  city?: string;
  state?: string;
  postal_code?: string;
  country_code?: string;
}

export interface ReservationNote {
  description: string;
}

export interface ReservationAddon {
  id: number;
  quantity: number;
}

export interface CreateReservationRequest {
  hotel_id: number;
  arrival_date: string;
  departure_date: string;
  stay_dates: ReservationStayDate[];
  guests: ReservationGuest[];
  notes?: ReservationNote[];
  addons?: ReservationAddon[];
}

export interface UpdateReservationGuest {
  id?: string;
  is_primary?: boolean;
  first_name?: string;
  last_name?: string;
  email?: string;
}

export interface UpdateReservationRequest {
  arrival_date: string;
  departure_date: string;
  arrival_time?: string;
  departure_time?: string;
  stay_dates?: ReservationStayDate[];
  guests?: UpdateReservationGuest[];
  company?: { id?: number; account_number?: string; access_code?: string };
  travel_agent?: { id?: number; account_number?: string; access_code?: string };
  addons?: ReservationAddon[];
  booking_origin_code?: string;
  promotion_code?: string;
  reservation_type_code?: string;
  segment_code?: string;
  purpose_of_stay_code?: string;
  booker_email?: string;
  notes?: ReservationNote[];
  do_not_move?: boolean;
}
