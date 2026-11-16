export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  REFUND_IN_PROGRESS = 'REFUND_IN_PROGRESS',
  REFUND_FAILED = 'REFUND_FAILED',
}

export const stalePaymentStatuses = [
  PaymentStatus.PENDING,
  PaymentStatus.FAILED,
];

export const statusOfPaymentsToCancelAfterDisablingAutoCharge = [
  PaymentStatus.PENDING,
  PaymentStatus.FAILED,
];
