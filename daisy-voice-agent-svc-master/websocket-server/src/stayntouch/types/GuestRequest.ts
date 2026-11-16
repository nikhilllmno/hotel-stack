export interface GuestAddress {
  city: string;
  state: string;
  postal_code: string;
  country_code: string;
}

export interface CreateGuestRequest {
  first_name: string;
  last_name: string;
  email: string;
  address: GuestAddress;
  mobile_phone: string;
}

export interface UpdateGuestAddress {
  id: number;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country_code?: string;
}

export interface UpdateGuestNote {
  description: string;
}

export interface UpdateGuestRequest {
  first_name?: string;
  last_name?: string;
  email?: string;
  address?: UpdateGuestAddress;
  birthday?: string;
  is_vip?: boolean;
  title?: string;
  works_at?: string;
  job_title?: string;
  nationality?: string;
  home_phone?: string;
  language?: string;
  opted_promotional_emails?: boolean;
  mobile_phone?: string;
  gender?: string;
  vehicle_registration_number?: string;
  vehicle_country_code?: string;
  is_flagged?: boolean;
  flagged_reason?: string;
  id_type?: string;
  id_number?: string;
  id_issue_date?: string;
  id_expiry_date?: string;
  entry_date?: string;
  father_name?: string;
  mother_name?: string;
  birth_place?: string;
  home_town?: string;
  residence?: string;
  personal_no?: string;
  notes?: UpdateGuestNote[];
}
