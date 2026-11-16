import { ThreeDSecure } from '../types/shift4';
import { BaseModel } from './BaseModel';

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

export interface Customer extends BaseModel {
  hotel_id: string;
  phone_number: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  payment_provider_customer_id?: string;
  signature?: string | null;
  device_details?: DeviceDetails | null;
  card_metadata?: CardMetadata | null;
}
