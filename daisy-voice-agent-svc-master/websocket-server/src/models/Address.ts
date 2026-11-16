import { BaseModel } from './BaseModel';

export enum AddressType {
  BILLING = 'billing',
  CONTACT = 'contact',
}

export interface Address extends BaseModel {
  customer_id: string;
  address_type: AddressType;
  state_or_province?: string;
  postal_code?: string;
  country?: string;
  address_first_line?: string;
  city?: string;
  ip_address?: string;
}
