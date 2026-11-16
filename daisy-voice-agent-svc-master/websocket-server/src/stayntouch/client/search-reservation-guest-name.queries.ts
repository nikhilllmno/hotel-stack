import { Knex } from 'knex';
import {
  buildGuestNamePartScoreBindings,
  buildSingleTokenGuestNameDbScoreSql,
  buildSingleTokenGuestNameScoreBindings,
  GUEST_SEARCH_NAME_SQL,
  isSingleTokenGuestName,
  normalizeGuestName,
} from './guest-name-similarity';

export interface GuestNameSimilarityMatch {
  reservationId: string;
  guestName: string;
  firstScore: number;
  lastScore: number;
  score: number;
  checkIn: string;
}

export async function findGuestNameSimilarityMatches(
  db: Knex,
  params: {
    hotelId: string;
    name: string;
    minSimilarity: number;
  },
): Promise<GuestNameSimilarityMatch[]> {
  const normalizedName = normalizeGuestName(params.name);

  if (isSingleTokenGuestName(normalizedName)) {
    return findSingleTokenGuestNameSimilarityMatches(
      db,
      params,
      normalizedName,
    );
  }

  return findMultiTokenGuestNameSimilarityMatches(db, params, normalizedName);
}

async function findSingleTokenGuestNameSimilarityMatches(
  db: Knex,
  params: {
    hotelId: string;
    minSimilarity: number;
  },
  normalizedName: string,
): Promise<GuestNameSimilarityMatch[]> {
  const fullNameScoreSql = buildSingleTokenGuestNameDbScoreSql();
  const tokenBindings = buildSingleTokenGuestNameScoreBindings(normalizedName);

  const result = await db.raw(
    `
      SELECT
        r.id AS reservation_id,
        ${GUEST_SEARCH_NAME_SQL} AS guest_name,
        ${fullNameScoreSql} AS first_score,
        ${fullNameScoreSql} AS last_score,
        r.check_in AS check_in
      FROM reservations r
      INNER JOIN customers c ON c.id = r.customer_id
      WHERE r.hotel_id = ?
        AND ${fullNameScoreSql} >= ?
    `,
    [
      ...tokenBindings,
      ...tokenBindings,
      params.hotelId,
      ...tokenBindings,
      params.minSimilarity,
    ],
  );

  return mapSimilarityRows(result);
}

async function findMultiTokenGuestNameSimilarityMatches(
  db: Knex,
  params: {
    hotelId: string;
    minSimilarity: number;
  },
  normalizedName: string,
): Promise<GuestNameSimilarityMatch[]> {
  const {
    firstScoreSql,
    lastScoreSql,
    filterScoreSql,
    bindings: scoreBindings,
  } = buildGuestNamePartScoreBindings(normalizedName);

  const result = await db.raw(
    `
      SELECT
        r.id AS reservation_id,
        ${GUEST_SEARCH_NAME_SQL} AS guest_name,
        ${firstScoreSql} AS first_score,
        ${lastScoreSql} AS last_score,
        r.check_in AS check_in
      FROM reservations r
      INNER JOIN customers c ON c.id = r.customer_id
      WHERE r.hotel_id = ?
        AND ${filterScoreSql} >= ?
    `,
    [...scoreBindings, params.hotelId, ...scoreBindings, params.minSimilarity],
  );

  return mapSimilarityRows(result);
}

function mapSimilarityRows(result: {
  rows?: Array<{
    reservation_id: string;
    guest_name: string;
    first_score: number | string;
    last_score: number | string;
    check_in: string | Date;
  }>;
}): GuestNameSimilarityMatch[] {
  const rows = result.rows ?? [];

  return rows.map((row) => ({
    reservationId: String(row.reservation_id),
    guestName: String(row.guest_name),
    firstScore: Number(row.first_score),
    lastScore: Number(row.last_score),
    score: 0,
    checkIn: formatCheckIn(row.check_in),
  }));
}

function formatCheckIn(checkIn: string | Date): string {
  if (checkIn instanceof Date) {
    return checkIn.toISOString().slice(0, 10);
  }

  return String(checkIn).slice(0, 10);
}
