import { PaymentStatus } from '@/dtos/enum/PaymentStatus';
import { PaymentRefundInfo } from '@/dtos/refund/RefundDto';
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { createTestPaymentService } from '@/test/stubs/createTestPaymentService';
import { PaymentProvider } from '@/types/enums';
import { PaymentService } from '../paymentService';

/**
 * Regression coverage for the refund off-by-epsilon bug: the greedy allocator
 * subtracted a rounded chunk from an unrounded running total, so a full refund
 * spread across multiple payments left a ~1e-13 residue and was wrongly
 * rejected as "Insufficient refundable amount" even though requested == available.
 * Production repro: booking BK02188 (The Edgewater Hotel), 1243.19 refund.
 */
describe('PaymentService.selectPaymentsForRefund (refund off-by-epsilon)', () => {
  const ctx = installPgMemTestContext();
  let paymentService: PaymentService;

  beforeEach(() => {
    paymentService = createTestPaymentService({
      knex: ctx.knex,
    }).paymentService;
  });

  const makePayment = (
    paymentId: string,
    refundableAmount: number,
  ): PaymentRefundInfo => ({
    paymentId,
    amountCharged: refundableAmount,
    amountRefunded: 0,
    refundableAmount,
    paymentStatus: PaymentStatus.COMPLETED,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    paymentProvider: PaymentProvider.STRIPE,
    hotelId: '978517d7-1298-4e2d-96aa-d3e66ba97ac7',
    hotelTimezone: 'America/Los_Angeles',
    bookingConfirmationId: 'BK02188',
  });

  const selectPaymentsForRefund = (
    payments: PaymentRefundInfo[],
    requestedAmount: number,
  ): Promise<Array<{ payment: PaymentRefundInfo; refundAmount: number }>> =>
    (
      paymentService as unknown as {
        selectPaymentsForRefund: (
          p: PaymentRefundInfo[],
          amount: number,
        ) => Promise<
          Array<{ payment: PaymentRefundInfo; refundAmount: number }>
        >;
      }
    ).selectPaymentsForRefund(payments, requestedAmount);

  it('fully allocates an equal-split refund whose float residue would otherwise reject it', async () => {
    // 414.40 + 414.40 + 414.39 === 1243.19; the greedy subtraction accumulates
    // a ~1e-13 residue that the old code treated as still-owed.
    const payments = [
      makePayment('pay-1', 414.4),
      makePayment('pay-2', 414.4),
      makePayment('pay-3', 414.39),
    ];

    const selected = await selectPaymentsForRefund(payments, 1243.19);

    expect(selected).toHaveLength(3);
    const total = selected.reduce((sum, s) => sum + s.refundAmount, 0);
    expect(total).toBeCloseTo(1243.19, 2);
  });

  it('allocates the exact BK02188 refund (994.56 + 248.64, requested 1243.19)', async () => {
    // Production repro: 994.56 + 248.64 === 1243.20, but their IEEE-754 sum is
    // 1243.1999999999998. Refunding the floor-displayed 1243.19 left the greedy
    // loop with a ~1.1e-13 residue (1243.19 - 994.56 = 248.6300000000001, then
    // - 248.63), which the old code rejected as "Insufficient refundable amount".
    const payments = [
      makePayment('pay-994', 994.56),
      makePayment('pay-248', 248.64),
    ];

    const selected = await selectPaymentsForRefund(payments, 1243.19);

    expect(selected).toHaveLength(2);
    expect(selected.map((s) => s.refundAmount)).toEqual([994.56, 248.63]);
    const total = selected.reduce((sum, s) => sum + s.refundAmount, 0);
    expect(total).toBeCloseTo(1243.19, 2);
  });

  it('allocates the BK02188 payments when requesting the full unrounded float sum', async () => {
    const payments = [
      makePayment('pay-994', 994.56),
      makePayment('pay-248', 248.64),
    ];

    // 994.56 + 248.64 as a raw float — the value the payment-summary API returned
    // before it was rounded.
    const selected = await selectPaymentsForRefund(payments, 994.56 + 248.64);

    expect(selected).toHaveLength(2);
    expect(selected.map((s) => s.refundAmount)).toEqual([994.56, 248.64]);
    const total = selected.reduce((sum, s) => sum + s.refundAmount, 0);
    expect(total).toBeCloseTo(1243.2, 2);
  });

  it('allocates a full refund split across two uneven payments', async () => {
    const payments = [
      makePayment('pay-1', 1243.12),
      makePayment('pay-2', 0.07),
    ];

    const selected = await selectPaymentsForRefund(payments, 1243.19);

    expect(selected).toHaveLength(2);
    const total = selected.reduce((sum, s) => sum + s.refundAmount, 0);
    expect(total).toBeCloseTo(1243.19, 2);
  });

  it('still rejects when the requested amount genuinely exceeds refundable', async () => {
    const payments = [makePayment('pay-1', 500), makePayment('pay-2', 500)];

    await expect(selectPaymentsForRefund(payments, 1243.19)).rejects.toThrow(
      /Insufficient refundable amount/,
    );
  });
});
