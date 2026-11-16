import { AddressType } from '../models/Address';
export { AddressType };

export interface Address {
  id?: string;
  customer_id?: string;
  address_type?: AddressType;
  state_or_province?: string;
  postal_code?: string;
  country?: string;
  address_first_line?: string;
  city?: string;
  ip_address?: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface UpdateAddressBeforePayment {
  state_or_province: string;
  postal_code: string;
  country: string;
  city: string;
  address_first_line: string;
  ip_address?: string;
}
