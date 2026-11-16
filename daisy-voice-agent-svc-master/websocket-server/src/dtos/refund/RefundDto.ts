import { PaymentProvider } from '../../types/enums';
import { PaymentStatus } from '../enum/PaymentStatus';

export interface BookingRefundSummary {
  bookingId: string;
  totalReservationAmount: number;
  totalPaidAmount: number;
  totalRefundedAmount: number;
  refundableAmount: number;
  remainingAmount: number;
}

export interface PaymentRefundInfo {
  paymentId: string;
  amountCharged: number;
  amountRefunded: number;
  refundableAmount: number;
  paymentStatus: PaymentStatus;
  createdAt: Date;
  paymentProvider: PaymentProvider;
  hotelId: string;
  hotelTimezone: string;
  bookingConfirmationId?: string;
}

export interface RefundRequest {
  refundAmount: number;
  reason?: string;
  initiatedBy?: string;
  sendGuestNotification?: boolean;
}

export interface RefundProcessResult {
  success: boolean;
  totalRefundAmount: number;
  selectedPayments: RefundedPaymentInfo[];
  failedRefunds?: RefundFailure[];
}

export interface RefundedPaymentInfo {
  paymentId: string;
  refundAmount: number;
  stripeRefundId?: string;
  status: 'processing' | 'completed' | 'failed';
}

export interface RefundFailure {
  paymentId: string;
  error: string;
  refundAmount: number;
}

export interface StripeRefundParams {
  chargeId?: string;
  paymentIntentId?: string;
  amount?: number; // in cents, if not provided = full refund
  connectedAccountId?: string;
  metadata?: Record<string, string>;
}

export interface PaymentRefundParams {
  payment: PaymentRefundInfo;
  refundAmount: number;
  reason?: string;
  connectedAccountId?: string;
}
