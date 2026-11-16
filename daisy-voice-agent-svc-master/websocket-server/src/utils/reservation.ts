import {
  Reservation as ReservationDTO,
  ReservationWithPricingBreakdown,
} from '../dtos/Reservation';
import { roundCurrency } from './helper';

/**
 * Returns the total reservation amount derived from the quote (base_rate + taxes + fees).
 * Shared by RoomReservationService, StripeWebhookService, and GuestCheckinSummaryService
 * so that total-amount logic lives in a single place.
 */
export function getReservationTotalAmount(
  reservation: ReservationWithPricingBreakdown,
): number {
  const quote = reservation.quote;
  return roundCurrency(
    (quote?.base_rate ?? 0) + (quote?.taxes ?? 0) + (quote?.fees ?? 0),
  );
}

/**
 * Returns the identifier that should be shared with the guest for a single
 * reservation. When a PMS exposes a human-friendly confirmation number via
 * `external_public_id` (e.g. Stayntouch), that is preferred; otherwise we fall
 * back to the internal PMS `external_id`.
 */
export function getGuestFacingReservationId(
  reservation: Pick<ReservationDTO, 'external_public_id' | 'external_id'>,
): string | undefined {
  return reservation.external_public_id || reservation.external_id || undefined;
}

/**
 * Returns the distinct guest-facing IDs for the supplied reservations. Falsy
 * values are dropped and duplicates are removed while preserving input order.
 */
export function getGuestFacingReservationIds(
  reservations: Array<
    Pick<ReservationDTO, 'external_public_id' | 'external_id'>
  >,
): string[] {
  const ids = reservations
    .map((r) => getGuestFacingReservationId(r))
    .filter((id): id is string => Boolean(id));
  return Array.from(new Set(ids));
}
