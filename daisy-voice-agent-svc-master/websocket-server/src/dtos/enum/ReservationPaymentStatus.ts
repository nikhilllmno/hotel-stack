export enum ReservationPaymentStatus {
  PENDING = 'PENDING',
  FULLY_PAID = 'FULLY_PAID',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  FULLY_REFUNDED = 'FULLY_REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  REVIEW_PENDING = 'REVIEW_PENDING',
  NOT_APPLICABLE = 'NOT_APPLICABLE',
  /** The PMS takes the payment itself (see `PaymentProvider.RESNEXUS`). */
  EXTERNALLY_MANAGED = 'EXTERNALLY_MANAGED',
}

/** Statuses with no payments row. */
export const NO_DEXTR_PAYMENT_STATUSES: readonly ReservationPaymentStatus[] = [
  ReservationPaymentStatus.NOT_APPLICABLE,
  ReservationPaymentStatus.EXTERNALLY_MANAGED,
];

export function hasNoDextrPayment(
  status: ReservationPaymentStatus | string | null | undefined,
): boolean {
  return NO_DEXTR_PAYMENT_STATUSES.includes(status as ReservationPaymentStatus);
}

export function noDextrPaymentReason(
  status: ReservationPaymentStatus | string | null | undefined,
): string {
  return status === ReservationPaymentStatus.EXTERNALLY_MANAGED
    ? 'is paid directly to the property through its PMS'
    : 'does not require payment';
}
