import { Customer } from '../dtos/Customer';
import { ReservationStatus } from '../dtos/enum/ReservationStatus';
import { PMSQuote } from '../pms/types/Quote';

/** Platform (Dextr) pricing stored on quotes. Flat object; unknown keys allowed for future extensibility. */
export interface PlatformPricing {
  tax_rate?: number | null;
  pet_fee_incl_tax?: number | null;
  winback_discount_incl_tax?: number | null;
  length_of_stay_discount_incl_tax?: number | null;
  [key: string]: number | null | undefined;
}

export interface ReservationDetails {
  id: string;
  business_id: string;
  check_in: string;
  check_out: string;
  room_id: number | string;
  num_adults: number;
  customer: Customer;
  external_id: string;
  amountCharged?: number;
  quote?: PMSQuote & Record<string, any>;
  num_children?: number;
  num_pets?: number;
  base_rate?: number;
  taxes?: number;
  fees?: number;
  notes_from_partner?: string;
  phone_number?: string;
  status?: ReservationStatus;
  payment_link?: string;
  payment_id?: string;
}

export interface PricingBreakdown {
  /** Room base before discounts (PMS Charges). */
  pms_base_rate: number;
  resort_fee_gross: number;
  resort_fee_base: number;
  resort_fee_tax: number;
  /** Tax without discount applied: pre_discount_base * tax_rate (PMS Charges). */
  pms_tax: number;
  pet_fee_incl_tax: number | null;
  pet_fee_base: number | null;
  pet_fee_tax: number | null;
  winback_discount_incl_tax: number | null;
  tax_credit: number | null;
  length_of_stay_discount_incl_tax: number | null;
  length_of_stay_tax_credit: number | null;
}

export interface AutoChargeInfo {
  is_enabled: boolean;
  invoice_id?: string;
  amount?: number;
  finalizes_at?: Date;
  payment_id?: string;
  retry_count?: number;
}
