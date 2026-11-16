import dayjs from 'dayjs';
import { Knex } from 'knex';
import * as connection from '../../database/connection';
import { Reservation as ReservationDTO } from '../../dtos/Reservation';
import { ReservationRepository } from '../../repositories/ReservationRepository';
import logger from '../../utils/logger';
import {
  findGuestNameSimilarityMatches,
  GuestNameSimilarityMatch,
} from './search-reservation-guest-name.queries';

import { GUEST_NAME_SIMILARITY_THRESHOLD } from './guest-name-similarity';

export { GUEST_NAME_SIMILARITY_THRESHOLD };
export const FIRST_NAME_SIMILARITY_WEIGHT = 0.3;
export const LAST_NAME_SIMILARITY_WEIGHT = 0.7;

const TOP_NAME_COUNT = 3;
const STALE_FILTER_MIN_COUNT = 5;
const STALE_CHECKOUT_CUTOFF_DAYS = 7;

function getDb(): Knex {
  return connection.default;
}

/**
 * Note: DO NOT use this anywhere. Retaining the code here for potential
 * use in the future. Fuzzy matching creates a bad experience for the customer.
 * It's less of a headache even if the name is not captured correctly and an exact check is made.
 */
export async function searchReservationByGuestName(params: {
  hotelId: string;
  name: string;
  minSimilarity?: number;
}): Promise<ReservationDTO[]> {
  const db = getDb();
  const minSimilarity = params.minSimilarity ?? GUEST_NAME_SIMILARITY_THRESHOLD;

  const rawMatches = await findGuestNameSimilarityMatches(db, {
    hotelId: params.hotelId,
    name: params.name,
    minSimilarity,
  });

  let result: ReservationDTO[];

  if (rawMatches.length === 0) {
    result = [];
  } else {
    const matches = applyWeightedScoresAndSort(rawMatches);
    const reservationIds = selectTopGuestNameGroups(matches);
    const reservations = await fetchReservationsInOrder(db, reservationIds);
    result = filterStaleReservationsIfNeeded(reservations);
  }

  const uniqueGuestNames = [
    ...new Set(
      result
        .map(getReservationGuestName)
        .filter((guestName) => guestName.length > 0),
    ),
  ];

  logger.info(
    JSON.stringify({
      name: params.name,
      reservationCount: result.length,
      uniqueGuestNames,
    }),
  );

  return result;
}

function computeWeightedGuestNameScore(
  firstScore: number,
  lastScore: number,
): number {
  return (
    FIRST_NAME_SIMILARITY_WEIGHT * firstScore +
    LAST_NAME_SIMILARITY_WEIGHT * lastScore
  );
}

function applyWeightedScoresAndSort(
  matches: GuestNameSimilarityMatch[],
): GuestNameSimilarityMatch[] {
  return matches
    .map((match) => ({
      ...match,
      score: computeWeightedGuestNameScore(match.firstScore, match.lastScore),
    }))
    .sort((left, right) => {
      const scoreDiff = right.score - left.score;
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return left.checkIn.localeCompare(right.checkIn);
    });
}

async function fetchReservationsInOrder(
  db: Knex,
  reservationIds: string[],
): Promise<ReservationDTO[]> {
  const reservationRepository = new ReservationRepository(db);
  const reservations =
    await reservationRepository.findManyReservationWithDetailsByIds(
      reservationIds,
    );

  if (!reservations?.length) {
    return [];
  }

  const orderById = new Map(
    reservationIds.map((reservationId, index) => [reservationId, index]),
  );

  return reservations.sort(
    (left, right) =>
      (orderById.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (orderById.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

function selectTopGuestNameGroups(
  matches: GuestNameSimilarityMatch[],
  limit = TOP_NAME_COUNT,
): string[] {
  const groups = new Map<
    string,
    {
      bestScore: number;
      reservationIds: string[];
      checkIns: Map<string, string>;
    }
  >();

  for (const match of matches) {
    const existing = groups.get(match.guestName);

    if (existing) {
      existing.bestScore = Math.max(existing.bestScore, match.score);
      existing.reservationIds.push(match.reservationId);
      existing.checkIns.set(match.reservationId, match.checkIn);
      continue;
    }

    groups.set(match.guestName, {
      bestScore: match.score,
      reservationIds: [match.reservationId],
      checkIns: new Map([[match.reservationId, match.checkIn]]),
    });
  }

  const distinctScores = [
    ...new Set([...groups.values()].map((group) => group.bestScore)),
  ].sort((left, right) => right - left);

  const cutoffScore =
    distinctScores.length <= limit
      ? (distinctScores[distinctScores.length - 1] ?? 0)
      : distinctScores[limit - 1];

  const selectedGroups = [...groups.entries()]
    .filter(([, group]) => group.bestScore >= cutoffScore)
    .sort((left, right) => {
      const scoreDiff = right[1].bestScore - left[1].bestScore;
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return left[0].localeCompare(right[0]);
    });

  const reservationIds: string[] = [];

  for (const [, group] of selectedGroups) {
    const sortedIds = [...group.reservationIds].sort((left, right) => {
      const leftCheckIn = group.checkIns.get(left) ?? '';
      const rightCheckIn = group.checkIns.get(right) ?? '';
      return leftCheckIn.localeCompare(rightCheckIn);
    });

    reservationIds.push(...sortedIds);
  }

  return reservationIds;
}

function getReservationGuestName(reservation: ReservationDTO): string {
  const parts = [
    reservation.customer.first_name,
    reservation.customer.last_name,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part);

  return parts.join(' ');
}

function filterStaleReservationsIfNeeded(
  reservations: ReservationDTO[],
): ReservationDTO[] {
  if (reservations.length <= STALE_FILTER_MIN_COUNT) {
    return reservations;
  }

  const cutoff = dayjs()
    .subtract(STALE_CHECKOUT_CUTOFF_DAYS, 'day')
    .startOf('day');

  return reservations.filter((reservation) => {
    const checkOut = dayjs(reservation.check_out);
    return !checkOut.isBefore(cutoff, 'day');
  });
}
