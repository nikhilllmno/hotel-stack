import { SessionType } from '../dtos/enum/SessionType';
import { Country, PaymentProvider } from './enums';
import { PlatformFeeType } from './platformFee';

export interface Shift4RefundInvoice {
  invoice_id: string;
  amount: number;
  timestamp: string; // ISO
  reason: string;
}

export interface PaymentCreationMetadata {
  check_in: string;
  check_out: string;
  num_adults: number;
  num_children: number;
  room_count: number;
  reservation_type: SessionType;
  hotel_id: string;
  customer_id?: string;
  customer_phone: string;
  hotel_name: string;
  hotel_phone_number: string;
  hotel_sms_number: string;
  // hotel internal phone number is used to display to customer in SMS notifications
  hotel_internal_phone_number?: string;
  hotel_url: string;
  hotel_country: Country;
  payment_provider: PaymentProvider;
  first_name?: string;
  last_name?: string;
  email?: string;
  platform_fee_active?: boolean;
  platform_fee_type?: PlatformFeeType;
  platform_fee_value?: number;
  shift4_refund_invoice_data?: Shift4RefundInvoice[];
  mews_account_id?: string;
  mews_credit_card_id?: string;
  cloudbeds_card_id?: string;
  cloudbeds_transaction_id?: string;
  cloudbeds_payment_method_id?: string;
  /**
   * Posting ids returned by Opera cashiering, one per flow. Opera has no
   * idempotency key, so their presence is what stops a redelivered webhook or
   * a cron rerun posting the same money twice.
   */
  opera_posting_id?: string;
  opera_autocharge_posting_id?: string;
}

export interface PaymentMetadata extends PaymentCreationMetadata {
  payment_id: string;
  source?: string;
  action?: string;
}
