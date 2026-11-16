/**
 * Records money that moved on a Dextr rail (Stripe or Shift4) onto the Opera
 * folio of an Opera-backed Calry hotel.
 *
 * Nothing here moves money — the guest has already been charged by the time
 * these run, so a failure is a bookkeeping problem, not a payment problem, and
 * is logged rather than thrown. That is the same posture as
 * `createCloudbedsPayments` and `recordPaymentInStayntouch`, and both entry
 * points guard themselves so callers need no provider check.
 *
 * Money Opera settles itself does not come through here: it is posted by
 * `CalryOperaFolioService` at the point of settlement, and recording it again
 * would double-post.
 */

import { Reservation as ReservationDto } from '../../dtos/Reservation';
import { Payment } from '../../models/Payment';
import { hotelConfigurationService } from '../../services/hotelConfiguration/hotelConfigurationService';
import paymentService from '../../services/payment/paymentService';
import { PaymentProvider, PmsProvider } from '../../types/enums';
import { roundCurrency } from '../../utils/helper';
import { KpiStat } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import { getReservationTotalAmount } from '../../utils/reservation';
import { resolveCalryCredentials } from './calryCredentials';
import { resolveOperaTarget } from './operaAvailability';
import { operaFolioService } from './operaFolioService';

/**
 * Opera truncates a long posting reference, so the payment id is shortened to
 * the prefix that still makes a posting identifiable in the folio.
 */
const PAYMENT_ID_PREFIX_LENGTH = 8;

type RecorderFlow = 'deposit' | 'autocharge' | 'refund';

/**
 * Where a posting id is remembered, so a retry never posts twice. Keyed per
 * flow: a booking posts its deposit and, later, its balance, and the second
 * must not be skipped because the first is already recorded.
 */
const POSTING_ID_METADATA_KEY = {
  deposit: 'opera_posting_id',
  autocharge: 'opera_autocharge_posting_id',
} as const;

export function buildPostingReference(
  flow: RecorderFlow,
  paymentId: string,
): string {
  return `Dextr ${flow} ${paymentId.slice(0, PAYMENT_ID_PREFIX_LENGTH)}`;
}

/**
 * Whether this booking is an Opera-backed Calry hotel whose folio we can post
 * to. Calry also fronts non-Opera PMSes, and those have no folio to reach.
 */
async function resolveOperaHotelId(
  reservations: ReservationDto[],
): Promise<string | null> {
  if (reservations.length === 0) return null;
  if (reservations[0].pms_provider !== PmsProvider.CALRY) return null;

  const hotelId = reservations[0].hotel?.id ?? reservations[0].hotel_id;
  if (!hotelId) return null;

  const credentials = await resolveCalryCredentials(hotelId);
  const authConfig =
    await hotelConfigurationService.getExternalAuthConfigByHotelId(hotelId);

  return resolveOperaTarget(credentials, authConfig) ? hotelId : null;
}

/** Deposit posts the quoted deposit; autocharge posts what is left after it. */
function computeChargeAmount(
  reservation: ReservationDto,
  isAutoCharge: boolean,
): number | null {
  const depositAmount = roundCurrency(
    Number(reservation.quote?.amount_charged ?? 0),
  );
  if (!isAutoCharge) {
    return depositAmount > 0 ? depositAmount : null;
  }
  const remainingAmount = roundCurrency(
    getReservationTotalAmount(reservation) - depositAmount,
  );
  return remainingAmount > 0 ? remainingAmount : null;
}

export async function recordCollectedPaymentInOpera(params: {
  reservations: ReservationDto[];
  currency: string;
  payment: Payment;
  isAutoCharge?: boolean;
}): Promise<void> {
  const { reservations, currency, payment, isAutoCharge = false } = params;

  // An Opera-settled payment already reached the folio at the point of
  // settlement; recording it here as well would post the money twice.
  if (payment.payment_provider === PaymentProvider.OPERA) return;

  const hotelId = await resolveOperaHotelId(reservations).catch(() => null);
  if (!hotelId) return;

  const flow: RecorderFlow = isAutoCharge ? 'autocharge' : 'deposit';
  const postingReference = buildPostingReference(flow, payment.id);
  const metadataKey = POSTING_ID_METADATA_KEY[flow];

  if (payment.metadata?.[metadataKey]) {
    logger.info(
      `recordCollectedPaymentInOpera: Payment ${payment.id} already has its ${flow} posted to Opera, skipping`,
    );
    return;
  }

  const hotel = reservations[0].hotel;
  const clientId = hotel?.assistant_phone_number ?? hotelId;
  const authConfig =
    await hotelConfigurationService.getExternalAuthConfigByHotelId(hotelId);
  // The money was collected outside Opera, so it must post against a non-card
  // method — a card method would have Opera settle it a second time through OPI.
  const paymentMethodCode = authConfig?.operaExternalPaymentMethodCode ?? 'CA';

  const postingIds: string[] = [];
  let failed = false;

  for (const reservation of reservations) {
    const externalId = reservation.external_id;
    if (!externalId) {
      logger.warn(
        `recordCollectedPaymentInOpera: Skipping reservation ${reservation.id} - no external_id`,
      );
      continue;
    }

    const amount = computeChargeAmount(reservation, isAutoCharge);
    if (amount === null) continue;

    try {
      const postingId = await operaFolioService.postPayment({
        hotelId,
        reservationId: externalId,
        amount,
        currency,
        paymentMethodCode,
        postingReference,
        clientId,
        kpi: {
          success: KpiStat.OperaPaymentRecorded,
          failure: KpiStat.OperaPaymentRecordFailed,
        },
      });

      // Opera does not always return a posting id for a successful post, and
      // the id is what stops a redelivered webhook posting twice. Fall back to
      // the reference so the guard still arms — a marker is what matters here,
      // not the id itself.
      postingIds.push(postingId ?? postingReference);

      logger.info(
        `recordCollectedPaymentInOpera: Recorded ${amount} ${currency} on Opera reservation ${externalId} ` +
          `(payment ${payment.id}, method ${paymentMethodCode})`,
      );
    } catch (error) {
      // The guest has been charged and the booking stands; a folio that is
      // behind needs reconciling by hand, not a failed booking.
      logger.error(
        `recordCollectedPaymentInOpera: CRITICAL - collected ${amount} ${currency} for payment ${payment.id} ` +
          `but could not record it on Opera reservation ${externalId}. Manual reconciliation required.`,
        error,
      );
      failed = true;
    }
  }

  // Only claim the flow as posted once every reservation took it — otherwise a
  // retry would skip the ones still missing from their folios.
  if (postingIds.length > 0 && !failed) {
    await paymentService.updatePaymentMetadata(payment.id, {
      [metadataKey]: postingIds.join(','),
    });
  }
}

/**
 * Records a refund that was issued on Stripe or Shift4 as a reversal posting.
 * Swallows failures for the same reason as the payment path — the money has
 * already gone back to the guest.
 *
 * No posting-id short-circuit here: a payment can be refunded in parts, so a
 * remembered reversal would block the second one. This runs once per refund a
 * provider has already accepted, not on a redelivered event.
 */
export async function recordRefundInOpera(params: {
  reservations: ReservationDto[];
  amount: number;
  currency: string;
  payment: Payment;
}): Promise<void> {
  const { reservations, amount, currency, payment } = params;

  // An Opera-settled refund is reversed by `initiateOperaRefund` itself, which
  // posts to the folio directly; reversing again here would refund twice.
  if (payment.payment_provider === PaymentProvider.OPERA) return;

  const hotelId = await resolveOperaHotelId(reservations).catch(() => null);
  if (!hotelId) return;
  if (roundCurrency(amount) <= 0) return;

  const authConfig =
    await hotelConfigurationService.getExternalAuthConfigByHotelId(hotelId);

  const externalId = reservations.find((r) => r.external_id)?.external_id;
  if (!externalId) return;

  try {
    await operaFolioService.postRefund({
      hotelId,
      reservationId: externalId,
      amount,
      currency,
      // Money went back on the Dextr rail, so the folio records it against the
      // same non-card method the original payment was recorded under.
      paymentMethodCode: authConfig?.operaExternalPaymentMethodCode ?? 'CA',
      postingReference: buildPostingReference('refund', payment.id),
      clientId: reservations[0].hotel?.assistant_phone_number ?? hotelId,
    });
  } catch (error) {
    logger.error(
      `recordRefundInOpera: CRITICAL - refunded ${amount} ${currency} for payment ${payment.id} ` +
        `but could not reverse it on Opera reservation ${externalId}. Manual reconciliation required.`,
      error,
    );
  }
}
