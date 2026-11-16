/**
 * Rate plan selection for Calry.
 *
 * Calry's `POST /reservations` has no `ratePlanId` field, so a booking
 * cannot be bound to a rate plan. The best available approach is to pick
 * the hotel's configured plan out of `GET /quote`'s `ratePlans[]`, quote
 * that plan's price, and send the same number back as `totalPrice` on
 * create — then verify after the fact (see `PmsQuotedPriceMismatch`).
 *
 * Selection reuses the existing `hotel_configurations.rate_code_config`
 * rather than introducing a Calry-specific column, and follows the same
 * "no config means allow everything" semantics Stayntouch uses.
 *
 * `ratePlanId` and `name` are documented by Calry but absent from its
 * sample responses, so an unlabelled `ratePlans[]` degrades to the first
 * entry with a warning rather than failing the call.
 */

import { RateCodeConfig } from '../../types/hotelConfiguration';
import logger from '../../utils/logger';
import { CalryRatePlan } from '../types';

export interface SelectedRatePlan {
  plan: CalryRatePlan;
  /** The configured rate code this plan matched, if any. */
  rateCode: string | null;
  /** True when no configured code matched and the first plan was used. */
  isFallback: boolean;
}

function planMatchesCode(plan: CalryRatePlan, code: string): boolean {
  const upper = code.toUpperCase();
  if (
    plan.ratePlanId !== undefined &&
    String(plan.ratePlanId).toUpperCase() === upper
  ) {
    return true;
  }
  return !!plan.name && plan.name.toUpperCase() === upper;
}

export function selectRatePlan(
  ratePlans: CalryRatePlan[] | undefined,
  rateCodeConfig: RateCodeConfig | null | undefined,
  context: { hotelId?: string; roomTypeId?: string },
): SelectedRatePlan | null {
  if (!ratePlans?.length) return null;

  const allowed = rateCodeConfig?.allowed ?? [];

  for (const code of allowed) {
    const match = ratePlans.find((plan) => planMatchesCode(plan, code));
    if (match) {
      return { plan: match, rateCode: code.toUpperCase(), isFallback: false };
    }
  }

  if (allowed.length > 0) {
    logger.warn(
      'Calry selectRatePlan: no configured rate code matched; falling back to the first rate plan',
      {
        ...context,
        allowed,
        availablePlans: ratePlans.map((plan) => ({
          ratePlanId: plan.ratePlanId,
          name: plan.name,
          totalPrice: plan.totalPrice,
        })),
      },
    );
  }

  return { plan: ratePlans[0], rateCode: null, isFallback: true };
}

/**
 * All rate plans, ignoring `rate_code_config` — backs
 * `getAllRatesForRoomType`, whose contract is explicitly to bypass the
 * allow-list.
 */
export function describeRatePlans(
  ratePlans: CalryRatePlan[] | undefined,
): { name: string; totalPrice: number }[] {
  return (ratePlans ?? []).map((plan, index) => ({
    name: plan.name || String(plan.ratePlanId ?? `Rate ${index + 1}`),
    totalPrice: plan.totalPrice,
  }));
}
