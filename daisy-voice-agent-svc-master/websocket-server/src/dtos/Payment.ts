import { PaymentProvider } from '../types/enums';
import { PaymentMetadata } from '../types/payment';
import { PaymentStatus } from './enum/PaymentStatus';

export interface Payment {
  id: string;
  booking_confirmation_id?: string;
  payment_link?: string;
  payment_link_id?: string;
  amount_charged: number;
  amount_refunded?: number;
  payment_status: PaymentStatus;
  payment_provider: PaymentProvider;
  currency: string;
  metadata?: any;
  created_at?: Date;
  updated_at?: Date;
}

export interface MarkPaymentCollectedRequest {
  amount?: number;
  payment_method?: string;
  notes?: string;
  collected_at?: Date;
}

export interface MarkPaymentCollectedResponse {
  success: boolean;
  message: string;
  payment_id: string;
  amount_collected: number;
  remaining_amount: number;
  total_reservation_amount: number;
  reservations_affected: string[];
}

export interface CreateInvoiceParams {
  customer_id: string;
  amount: number;
  currency: string;
  description: string;
  auto_finalize_at: number; // Unix timestamp
  metadata: PaymentMetadata;
  connectedAccountId?: string;
}

export interface UpdateInvoiceParams {
  auto_finalize_at?: number;
  auto_advance?: boolean;
  description?: string;
  metadata?: PaymentMetadata;
  connectedAccountId?: string;
}

export interface CreateInvoiceItemParams {
  customer: string;
  invoice: string;
  amount: number;
  currency: string;
  description: string;
  connectedAccountId?: string;
}

export interface ChargeReservationRequest {
  amount: number;
  reason?: string;
  send_guest_notification?: boolean;
}

export interface ChargeReservationResponse {
  success: boolean;
  message: string;
  payment_id?: string;
  amount_charged: number;
  charge_id?: string;
  payment_status?: string;
  reservation_ids: string[];
}

export interface CreatePaymentIntentResponse {
  paymentRecord?: Payment;
  chargeId?: string;
  success: boolean;
  error?: string;
}
