/**
 * Opera availability and pricing for Calry hotels, read through Calry's
 * passthrough instead of its unified endpoints.
 *
 * Two Opera calls stand in for the one Calry `/availability` + `/quote` pair:
 * `availability/alternate` says whether a rate plan sells a room type on
 * every night of the stay, and `reservations/rateInfo` prices it. Both are
 * scoped to a single rate plan, so a plan must be chosen *before* asking —
 * the reverse of the unified path, where `/quote` returns every plan and the
 * hotel's `rate_code_config` picks one afterwards.
 *
 * Consequences worth knowing:
 * - `alternate` reports status only, never unit counts, so availability is a
 *   boolean and `available_units` degrades to 1.
 * - A plan can price a stay it is restricted from selling, so both signals
 *   are required before a room type counts as bookable.
 */

import config from '../../config';
import {
  ExternalAuthConfig,
  RateCodeConfig,
} from '../../types/hotelConfiguration';
import logger from '../../utils/logger';
import operaClient from '../client/OperaClient';
import {
  CalryCredentials,
  OPERA_STATUS_AVAILABLE,
  OperaRateInfoResponse,
  OperaRatePlan,
  OperaRoomTypeLov,
  OperaTarget,
} from '../types';

/**
 * How many rate plans are tried for one room type when the hotel has no
 * `rate_code_config`. Each candidate costs two Opera calls, and a property
 * can define hundreds of plans, so an unconfigured hotel gets a bounded
 * best-effort search rather than an exhaustive one.
 */
const MAX_UNCONFIGURED_CANDIDATES = config.OPERA_MAX_RATE_PLAN_CANDIDATES;

export interface OperaOffer {
  ratePlanCode: string;
  rateInfo: OperaRateInfoResponse;
}

/**
 * Where to address Opera for this hotel. Per-hotel config wins; the env vars
 * are a single-property fallback for local testing and are only honoured
 * when they name the same property the hotel is already bound to, so a Calry
 * hotel on some other PMS can never be routed to Opera by accident.
 */
export function resolveOperaTarget(
  credentials: CalryCredentials,
  authConfig: ExternalAuthConfig | null | undefined,
): OperaTarget | null {
  if (authConfig?.operaHost && authConfig.operaPropertyCode) {
    return {
      host: authConfig.operaHost,
      propertyCode: authConfig.operaPropertyCode,
    };
  }

  if (
    config.OPERA_HOST &&
    config.OPERA_HOTEL_ID &&
    config.OPERA_HOTEL_ID === credentials.propertyId
  ) {
    return { host: config.OPERA_HOST, propertyCode: config.OPERA_HOTEL_ID };
  }

  return null;
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * The Opera room type code behind a Calry room type. Calry reports Opera
 * rooms as room types and carries no code, so the configured map is used
 * first and the room description second — the description Opera holds for a
 * room type usually *starts with* what Calry reports for its rooms
 * (`Economy Room` vs `Economy Room ECO Test`).
 *
 * An ambiguous description resolves to null rather than a guess: picking the
 * wrong room type would price and sell the wrong room.
 */
export function resolveOperaRoomTypeCode({
  calryRoomTypeId,
  description,
  name,
  operaRoomTypes,
  roomTypeMap,
}: {
  calryRoomTypeId: string;
  description?: string;
  name?: string;
  operaRoomTypes: OperaRoomTypeLov[];
  roomTypeMap?: Record<string, string>;
}): string | null {
  const mapped = roomTypeMap?.[calryRoomTypeId];
  if (mapped) return mapped;

  const labels = [description, name].filter((label): label is string =>
    Boolean(label?.trim()),
  );

  for (const label of labels) {
    const target = normalize(label);

    const exact = operaRoomTypes.filter(
      (roomType) =>
        normalize(roomType.description ?? '') === target ||
        normalize(roomType.name ?? '') === target ||
        normalize(roomType.code) === target,
    );
    if (exact.length === 1) return exact[0].code;

    const prefixed = operaRoomTypes.filter((roomType) =>
      [roomType.description, roomType.name].some((candidate) =>
        candidate ? normalize(candidate).startsWith(target) : false,
      ),
    );
    if (prefixed.length === 1) return prefixed[0].code;

    if (exact.length > 1 || prefixed.length > 1) {
      logger.warn(
        'Opera resolveOperaRoomTypeCode: description matches several room types; configure operaRoomTypeMap',
        {
          calryRoomTypeId,
          label,
          candidates: (exact.length ? exact : prefixed).map((r) => r.code),
        },
      );
      return null;
    }
  }

  logger.warn('Opera resolveOperaRoomTypeCode: no Opera room type matched', {
    calryRoomTypeId,
    description,
    name,
  });
  return null;
}

/**
 * Rate plans worth trying for a room type, most specific first: the hotel's
 * configured codes, else the plans Opera says sell that room type.
 */
export function candidateRatePlans({
  ratePlans,
  roomType,
  rateCodeConfig,
}: {
  ratePlans: OperaRatePlan[];
  roomType: string;
  rateCodeConfig: RateCodeConfig | null | undefined;
}): string[] {
  const sellsRoomType = ratePlans.filter((plan) =>
    (plan.roomTypeList ?? []).some(
      (room) => room.code.toUpperCase() === roomType.toUpperCase(),
    ),
  );

  const allowed = rateCodeConfig?.allowed ?? [];
  if (allowed.length) {
    const allowedUpper = allowed.map((code) => code.toUpperCase());
    return sellsRoomType
      .filter((plan) => allowedUpper.includes(plan.ratePlanCode.toUpperCase()))
      .map((plan) => plan.ratePlanCode);
  }

  return sellsRoomType
    .slice(0, MAX_UNCONFIGURED_CANDIDATES)
    .map((plan) => plan.ratePlanCode);
}

/**
 * True when Opera will sell every night of the stay. The endpoint returns a
 * window wider than the dates asked for, so nights outside the stay are
 * ignored, and the checkout night is never occupied.
 *
 * `Restricted` counts as sellable. It means a restriction applies to the rate
 * (minimum stay, closed to arrival and so on), not that the room cannot be
 * booked: Opera accepts a reservation on a `Restricted` date, and on a
 * property where every rate plan carrying a schedule reports `Restricted`,
 * treating it as closed hides the entire inventory. Only an explicitly closed
 * status blocks the sale, and Opera enforces the real restriction on create.
 */
const OPERA_UNSELLABLE_STATUSES = new Set([
  'closedout',
  'closed',
  'notavailable',
  'soldout',
]);

function isOpenForStay(
  statuses: { date: string; status: string }[],
  startDate: string,
  endDate: string,
): boolean {
  const nights = statuses.filter(
    (entry) => entry.date >= startDate && entry.date < endDate,
  );
  if (!nights.length) return false;

  const blocked = nights.filter((night) =>
    OPERA_UNSELLABLE_STATUSES.has(night.status.trim().toLowerCase()),
  );
  if (blocked.length) return false;

  const restricted = nights.filter(
    (night) => night.status !== OPERA_STATUS_AVAILABLE,
  );
  if (restricted.length) {
    logger.info('Opera isOpenForStay: selling a restricted rate', {
      startDate,
      endDate,
      statuses: Array.from(new Set(restricted.map((n) => n.status))),
    });
  }

  return true;
}

function grossOf(rateInfo: OperaRateInfoResponse): number {
  return rateInfo.summary?.gross ?? 0;
}

/**
 * First rate plan that both sells the room type for the whole stay and
 * prices it above zero, or null when none does. A plan that is restricted or
 * priced at zero is skipped rather than surfaced as a bookable room.
 */
export async function findOperaOffer({
  target,
  credentials,
  ratePlans,
  roomType,
  startDate,
  endDate,
  adults,
  rateCodeConfig,
}: {
  target: OperaTarget;
  credentials: CalryCredentials;
  ratePlans: OperaRatePlan[];
  roomType: string;
  startDate: string;
  endDate: string;
  adults: number;
  rateCodeConfig: RateCodeConfig | null | undefined;
}): Promise<OperaOffer | null> {
  const candidates = candidateRatePlans({
    ratePlans,
    roomType,
    rateCodeConfig,
  });

  for (const ratePlanCode of candidates) {
    try {
      const statuses = await operaClient.getDateStatuses(
        target,
        {
          ratePlanCode,
          roomType,
          startDate,
          endDate,
          adults: Math.max(1, adults),
        },
        credentials,
      );

      if (!isOpenForStay(statuses, startDate, endDate)) continue;

      const rateInfo = await operaClient.getRateInfo(
        target,
        {
          ratePlanCode,
          roomType,
          adults: Math.max(1, adults),
          criteriaStartDate: startDate,
          criteriaEndDate: endDate,
        },
        credentials,
      );

      if (grossOf(rateInfo) <= 0) continue;

      return { ratePlanCode, rateInfo };
    } catch (error) {
      logger.warn('Opera findOperaOffer: rate plan check failed', {
        ratePlanCode,
        roomType,
        error: (error as Error).message,
      });
    }
  }

  return null;
}

/**
 * Availability without pricing, for the paths that only need to know whether
 * a stay can still be moved into a room type.
 */
export async function isOperaRangeAvailable({
  target,
  credentials,
  ratePlans,
  roomType,
  startDate,
  endDate,
  rateCodeConfig,
}: {
  target: OperaTarget;
  credentials: CalryCredentials;
  ratePlans: OperaRatePlan[];
  roomType: string;
  startDate: string;
  endDate: string;
  rateCodeConfig: RateCodeConfig | null | undefined;
}): Promise<boolean> {
  const candidates = candidateRatePlans({
    ratePlans,
    roomType,
    rateCodeConfig,
  });

  for (const ratePlanCode of candidates) {
    const statuses = await operaClient
      .getDateStatuses(
        target,
        { ratePlanCode, roomType, startDate, endDate, adults: 1 },
        credentials,
      )
      .catch(() => []);

    if (isOpenForStay(statuses, startDate, endDate)) return true;
  }

  return false;
}
