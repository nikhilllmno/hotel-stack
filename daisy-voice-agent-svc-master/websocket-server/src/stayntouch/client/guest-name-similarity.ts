import { Knex } from 'knex';
import * as connection from '../../database/connection';
import { Reservation as ReservationDTO } from '../../dtos/Reservation';

export const GUEST_NAME_SIMILARITY_THRESHOLD = 0.22;

export const GUEST_SEARCH_NAME_SQL =
  "lower(trim(concat_ws(' ', nullif(trim(c.first_name), ''), nullif(trim(c.last_name), ''))))";
export const CUSTOMER_FIRST_NAME_SQL = 'lower(trim(c.first_name))';
export const CUSTOMER_LAST_NAME_SQL = 'lower(trim(c.last_name))';

const GUEST_LITERAL_FIRST_NAME_SQL = 'lower(trim(v.first_name))';
const GUEST_LITERAL_LAST_NAME_SQL = 'lower(trim(v.last_name))';
const GUEST_LITERAL_FULL_NAME_SQL =
  "lower(trim(concat_ws(' ', nullif(trim(v.first_name), ''), nullif(trim(v.last_name), ''))))";

interface GuestNameParts {
  first: string;
  last: string;
}

export interface GuestNamePartScoreBindings {
  firstScoreSql: string;
  lastScoreSql: string;
  filterScoreSql: string;
  bindings: string[];
}

function getDb(): Knex {
  return connection.default;
}

export function normalizeGuestName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function splitGuestNameParts(normalizedName: string): GuestNameParts {
  const parts = normalizedName.split(' ').filter(Boolean);

  if (parts.length === 0) {
    return { first: '', last: '' };
  }

  if (parts.length === 1) {
    return { first: parts[0], last: '' };
  }

  return {
    first: parts[0],
    last: parts.slice(1).join(' '),
  };
}

function partSimilaritySql(fieldSql: string): string {
  return `GREATEST(similarity(${fieldSql}, ?), word_similarity(?, ${fieldSql}))`;
}

function buildFullNameSimilarityScoreSql(fullNameSql: string): string {
  return `GREATEST(similarity(${fullNameSql}, ?), word_similarity(?, ${fullNameSql}))`;
}

export function isSingleTokenGuestName(normalizedName: string): boolean {
  return splitGuestNameParts(normalizedName).last === '';
}

export function buildSingleTokenGuestNameDbScoreSql(): string {
  return buildFullNameSimilarityScoreSql(GUEST_SEARCH_NAME_SQL);
}

export function buildSingleTokenGuestNameScoreBindings(
  normalizedName: string,
): [string, string] {
  return [normalizedName, normalizedName];
}

function buildDualPartGuestNamePartScoresSql(
  firstNameSql: string,
  lastNameSql: string,
): {
  firstScoreSql: string;
  lastScoreSql: string;
  filterScoreSql: string;
} {
  const normalFirst = partSimilaritySql(firstNameSql);
  const normalLast = partSimilaritySql(lastNameSql);
  const reversedFirst = partSimilaritySql(firstNameSql);
  const reversedLast = partSimilaritySql(lastNameSql);

  return {
    firstScoreSql: `GREATEST(${normalFirst}, ${reversedLast})`,
    lastScoreSql: `GREATEST(${normalLast}, ${reversedFirst})`,
    filterScoreSql: `GREATEST(
      LEAST(${normalFirst}, ${normalLast}),
      LEAST(${reversedFirst}, ${reversedLast})
    )`,
  };
}

export function buildGuestNamePartScoreBindings(
  normalizedName: string,
): GuestNamePartScoreBindings {
  const nameParts = splitGuestNameParts(normalizedName);

  const { firstScoreSql, lastScoreSql, filterScoreSql } =
    buildDualPartGuestNamePartScoresSql(
      CUSTOMER_FIRST_NAME_SQL,
      CUSTOMER_LAST_NAME_SQL,
    );

  return {
    firstScoreSql,
    lastScoreSql,
    filterScoreSql,
    bindings: [
      nameParts.first,
      nameParts.first,
      nameParts.last,
      nameParts.last,
      nameParts.last,
      nameParts.last,
      nameParts.first,
      nameParts.first,
    ],
  };
}

function buildGuestNameLiteralPartScoreBindings(
  normalizedName: string,
): GuestNamePartScoreBindings {
  const nameParts = splitGuestNameParts(normalizedName);

  if (!nameParts.last) {
    const fullNameScoreSql = buildFullNameSimilarityScoreSql(
      GUEST_LITERAL_FULL_NAME_SQL,
    );

    return {
      firstScoreSql: fullNameScoreSql,
      lastScoreSql: fullNameScoreSql,
      filterScoreSql: fullNameScoreSql,
      bindings: buildSingleTokenGuestNameScoreBindings(normalizedName),
    };
  }

  const { firstScoreSql, lastScoreSql, filterScoreSql } =
    buildDualPartGuestNamePartScoresSql(
      GUEST_LITERAL_FIRST_NAME_SQL,
      GUEST_LITERAL_LAST_NAME_SQL,
    );

  return {
    firstScoreSql,
    lastScoreSql,
    filterScoreSql,
    bindings: [
      nameParts.first,
      nameParts.first,
      nameParts.last,
      nameParts.last,
      nameParts.last,
      nameParts.last,
      nameParts.first,
      nameParts.first,
    ],
  };
}

export async function computeGuestNameFilterScore(
  searchName: string,
  guestFirst: string,
  guestLast: string,
): Promise<number> {
  const db = getDb();
  const normalizedName = normalizeGuestName(searchName);
  const { filterScoreSql, bindings } =
    buildGuestNameLiteralPartScoreBindings(normalizedName);

  const result = await db.raw(
    `
      SELECT (${filterScoreSql})::float AS score
      FROM (VALUES (?, ?, ?)) AS v(id, first_name, last_name)
    `,
    ['0', guestFirst ?? '', guestLast ?? '', ...bindings],
  );

  const row = result.rows?.[0] as { score?: number | string } | undefined;
  return Number(row?.score ?? 0);
}

export async function isGuestNameSimilar(
  searchName: string,
  guestFirst: string,
  guestLast: string,
  minSimilarity: number = GUEST_NAME_SIMILARITY_THRESHOLD,
): Promise<boolean> {
  const score = await computeGuestNameFilterScore(
    searchName,
    guestFirst,
    guestLast,
  );
  return score >= minSimilarity;
}

interface GuestNameCandidate {
  id: string;
  firstName: string;
  lastName: string;
}

async function filterGuestIdsByNameSimilarity(
  searchName: string,
  candidates: GuestNameCandidate[],
  minSimilarity: number,
): Promise<string[]> {
  if (candidates.length === 0) {
    return [];
  }

  const normalizedName = normalizeGuestName(searchName);
  const { filterScoreSql, bindings: scoreBindings } =
    buildGuestNameLiteralPartScoreBindings(normalizedName);

  const valuePlaceholders = candidates.map(() => '(?, ?, ?)').join(', ');
  const valueBindings = candidates.flatMap((candidate) => [
    candidate.id,
    candidate.firstName ?? '',
    candidate.lastName ?? '',
  ]);

  const db = getDb();
  const result = await db.raw(
    `
      SELECT v.id::text AS id
      FROM (VALUES ${valuePlaceholders}) AS v(id, first_name, last_name)
      WHERE (${filterScoreSql}) >= ?
    `,
    [...valueBindings, ...scoreBindings, minSimilarity],
  );

  const rows = (result.rows ?? []) as Array<{ id: string }>;
  return rows.map((row) => String(row.id));
}

export async function filterReservationsByGuestNameSimilarity(
  searchName: string,
  reservations: ReservationDTO[],
  minSimilarity: number = GUEST_NAME_SIMILARITY_THRESHOLD,
): Promise<ReservationDTO[]> {
  if (reservations.length === 0) {
    return [];
  }

  const candidates = reservations.map((reservation) => ({
    id: reservation.id,
    firstName: reservation.customer.first_name ?? '',
    lastName: reservation.customer.last_name ?? '',
  }));

  const matchingIds = new Set(
    await filterGuestIdsByNameSimilarity(searchName, candidates, minSimilarity),
  );

  return reservations.filter((reservation) => matchingIds.has(reservation.id));
}
