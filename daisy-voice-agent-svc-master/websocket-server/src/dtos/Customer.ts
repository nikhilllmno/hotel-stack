import { ThreeDSecure } from '../types/shift4';
import { Address, UpdateAddressBeforePayment } from './Address';

export interface DeviceDetails {
  customer_ip?: string;
  customer_location?: string;
  browser?: string;
  device_type?: string;
}

export interface CardMetadata {
  token: string;
  expiration_month?: string;
  expiration_year?: string;
  transaction_id?: string;
  threeDSecure?: ThreeDSecure;
  // Mews: Account (Customer) id that owns the stored card — needed for refunds.
  mews_account_id?: string;
  // Authorize.Net: CIM profile for auto-charge + COF compliance fields
  authnet_customer_profile_id?: string;
  authnet_payment_profile_id?: string;
  authnet_network_trans_id?: string;
  authnet_original_auth_amount?: number;
  authnet_last_four?: string;
  authnet_card_type?: string;
  authnet_exp_date?: string;
}

export interface Customer {
  phone_number: string;
  hotel_id: string;
  id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  payment_provider_customer_id?: string;
  address?: Address | null;
  billing_address?: Address | null;
  signature?: string | null;
  device_details?: DeviceDetails | null;
  card_metadata?: CardMetadata | null;
  signature_presigned_url?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface UpdateCustomerDataBeforePayment {
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  payment_provider_customer_id?: string;
  card_metadata?: CardMetadata;
  address: UpdateAddressBeforePayment;
  billing_address: UpdateAddressBeforePayment;
}
