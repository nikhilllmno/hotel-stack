import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Knex } from 'knex';
import config from '../../config';
import db from '../../database/connection';
import { NoDataError } from '../../errors/NoDataError';
import { VapiCallArtifact } from '../../models/request/EndOfCallReport';
import { createHttpClient } from '../../utils/httpClient';
import logger from '../../utils/logger';
import { HotelService, hotelService } from '../hotel/hotelService';
import {
  isPrivateVapiRecordingUrl,
  persistCallRecordingToS3,
} from './recordingUpload';

dayjs.extend(utc);
dayjs.extend(timezone);

const LOG_PREFIX = 'recordingBackfillService';
const VAPI_MAX_RETRIES = 4;
const VAPI_RETRY_BASE_MS = 1000;

const vapiApiClient = createHttpClient('vapi-recording', {
  baseURL: config.VAPI_API_BASE_URL,
});

export interface RecordingBackfillParams {
  hotelId: string;
  /** Calendar date YYYY-MM-DD in the hotel's timezone. */
  date: string;
}

export interface RecordingBackfillStats {
  hotelId: string;
  date: string;
  timezone: string;
  total: number;
  uploaded: number;
  skipped: number;
  failed: number;
  error?: string;
}

export interface RecordingBackfillAllHotelsResult {
  date: string;
  hotelsProcessed: number;
  hotelResults: RecordingBackfillStats[];
  totals: {
    total: number;
    uploaded: number;
    skipped: number;
    failed: number;
  };
}

export type RecordingBackfillConversationStatus =
  | 'uploaded'
  | 'skipped'
  | 'failed';

export interface RecordingBackfillConversationResult {
  conversationId: string;
  vapiCallId?: string;
  status: RecordingBackfillConversationStatus;
  recordingUrl?: string;
  reason?: string;
  error?: string;
}

interface BackfillRow {
  id: string;
  recording_url: string;
  hotel_id: string;
  conversation_session_id: string;
  metadata: Record<string, unknown> | null;
  external_provider_id: string | null;
}

interface MutableBackfillStats {
  uploaded: number;
  skipped: number;
  failed: number;
}

/** Prod uses VAPI_API_KEY; non-prod always uses VAPI_OLD_API_KEY. */
export function resolveVapiApiKeyForBackfill(): string {
  if (process.env.NODE_ENV === 'production') {
    if (!config.VAPI_API_KEY) {
      throw new Error('VAPI_API_KEY is not configured');
    }
    return config.VAPI_API_KEY;
  }

  if (!config.VAPI_OLD_API_KEY) {
    throw new Error('VAPI_OLD_API_KEY is not configured');
  }
  return config.VAPI_OLD_API_KEY;
}

function coerceHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.startsWith('http') ? trimmed : undefined;
}

function resolveRecordingUrlFromVapiArtifact(source: {
  artifact?: VapiCallArtifact;
  recordingUrl?: string;
  stereoRecordingUrl?: string;
}): string | undefined {
  const recording = source.artifact?.recording;
  if (recording && typeof recording === 'object') {
    const mono = recording.mono;
    const monoCombinedUrl =
      mono && typeof mono === 'object'
        ? coerceHttpUrl(mono.combinedUrl)
        : undefined;

    const url =
      coerceHttpUrl(recording.monoUrl) ??
      monoCombinedUrl ??
      (typeof mono === 'string' ? coerceHttpUrl(mono) : undefined) ??
      coerceHttpUrl(recording.stereoUrl) ??
      (typeof recording.stereo === 'string'
        ? coerceHttpUrl(recording.stereo)
        : undefined);
    if (url) return url;
  }

  return (
    coerceHttpUrl(source.artifact?.recordingUrl) ??
    coerceHttpUrl(source.recordingUrl) ??
    coerceHttpUrl(source.stereoRecordingUrl)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function vapiRetryDelayMs(err: unknown, attempt: number): number | undefined {
  const response = (
    err as { response?: { status?: number; headers?: Record<string, string> } }
  )?.response;
  const status = response?.status;
  if (status !== 429 && status !== 503) return undefined;

  const retryAfterHeader = response?.headers?.['retry-after'];
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }

  return Math.min(VAPI_RETRY_BASE_MS * 2 ** attempt, 30_000);
}

async function fetchRecordingUrlFromVapiCall(
  vapiCallId: string,
  vapiApiKey: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < VAPI_MAX_RETRIES; attempt++) {
    try {
      const response = await vapiApiClient.get(`call/${vapiCallId}`, {
        headers: { Authorization: `Bearer ${vapiApiKey}` },
      });
      return resolveRecordingUrlFromVapiArtifact(response.data) ?? null;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      if (status === 404) return null;

      const delayMs = vapiRetryDelayMs(err, attempt);
      if (delayMs !== undefined && attempt < VAPI_MAX_RETRIES - 1) {
        logger.warn(
          `${LOG_PREFIX}: VAPI ${status} for call ${vapiCallId}, retry in ${delayMs}ms`,
        );
        await sleep(delayMs);
        continue;
      }

      throw err;
    }
  }

  return null;
}

function resolveVapiCallId(row: BackfillRow): string | undefined {
  if (row.external_provider_id) {
    return row.external_provider_id;
  }

  const metadata = row.metadata ?? {};
  const fromMetadata =
    (typeof metadata.vapi_call_id === 'string' && metadata.vapi_call_id) ||
    (typeof (metadata.call as { id?: string } | undefined)?.id === 'string' &&
      (metadata.call as { id: string }).id) ||
    (typeof metadata.id === 'string' && metadata.id);

  return fromMetadata || undefined;
}

async function resolveDownloadUrl(
  vapiCallId: string,
  existingUrl: string,
  vapiApiKey: string,
): Promise<string | null> {
  const freshUrl = await fetchRecordingUrlFromVapiCall(vapiCallId, vapiApiKey);
  if (freshUrl) return freshUrl;

  if (existingUrl.startsWith('https://')) {
    return existingUrl;
  }

  return null;
}

async function loadBackfillRowByConversationId(
  knex: Knex,
  conversationId: string,
): Promise<BackfillRow | undefined> {
  const row = await knex('conversations as c')
    .leftJoin('sessions as s', 's.id', 'c.conversation_session_id')
    .where('c.id', conversationId)
    .select<BackfillRow>(
      'c.id',
      'c.recording_url',
      'c.hotel_id',
      'c.conversation_session_id',
      'c.metadata',
      's.external_provider_id',
    )
    .first();

  return row;
}

async function loadLegacyRecordingRowsForHotelDay(
  knex: Knex,
  hotelId: string,
  date: string,
): Promise<BackfillRow[]> {
  return knex('conversations as c')
    .leftJoin('sessions as s', 's.id', 'c.conversation_session_id')
    .innerJoin('hotels as h', 'h.id', 'c.hotel_id')
    .where('c.hotel_id', hotelId)
    .whereNotNull('c.recording_url')
    .where('c.recording_url', 'like', 'https://%')
    .whereRaw(
      `DATE_TRUNC('day', c.created_at AT TIME ZONE h.timezone)::date = ?::date`,
      [date],
    )
    .select<
      BackfillRow[]
    >('c.id', 'c.recording_url', 'c.hotel_id', 'c.conversation_session_id', 'c.metadata', 's.external_provider_id')
    .orderBy('c.created_at', 'asc');
}

async function migrateBackfillRow(
  knex: Knex,
  row: BackfillRow,
  vapiApiKey: string,
): Promise<RecordingBackfillConversationResult> {
  const vapiCallId = resolveVapiCallId(row);

  if (!vapiCallId || !row.hotel_id || !row.conversation_session_id) {
    logger.warn(
      `${LOG_PREFIX}: skip conversationId=${row.id} vapiCallId=${vapiCallId ?? 'unknown'} ` +
        '(missing call id, hotel_id, or session_id)',
    );
    return {
      conversationId: row.id,
      vapiCallId,
      status: 'skipped',
      reason: 'missing call id, hotel_id, or session_id',
    };
  }

  if (row.recording_url.startsWith('s3://')) {
    logger.info(
      `${LOG_PREFIX}: skip conversationId=${row.id} vapiCallId=${vapiCallId} (already on S3)`,
    );
    return {
      conversationId: row.id,
      vapiCallId,
      status: 'skipped',
      recordingUrl: row.recording_url,
      reason: 'already on S3',
    };
  }

  if (!row.recording_url.startsWith('https://')) {
    logger.warn(
      `${LOG_PREFIX}: skip conversationId=${row.id} vapiCallId=${vapiCallId} ` +
        '(recording_url is not a legacy https URL)',
    );
    return {
      conversationId: row.id,
      vapiCallId,
      status: 'skipped',
      reason: 'recording_url is not a legacy https URL',
    };
  }

  try {
    logger.info(
      `${LOG_PREFIX}: processing conversationId=${row.id} vapiCallId=${vapiCallId}`,
    );

    const privateUrl = isPrivateVapiRecordingUrl(row.recording_url);

    // HIPAA/private R2 URLs cannot be downloaded anonymously. Skip resolving a
    // "fresh" URL and download via GET /call/{id}/mono-recording with the API key.
    let downloadUrl: string = row.recording_url;
    if (!privateUrl) {
      const resolved = await resolveDownloadUrl(
        vapiCallId,
        row.recording_url,
        vapiApiKey,
      );
      if (!resolved) {
        logger.warn(
          `${LOG_PREFIX}: skip conversationId=${row.id} vapiCallId=${vapiCallId} (recording unavailable)`,
        );
        return {
          conversationId: row.id,
          vapiCallId,
          status: 'skipped',
          reason: 'recording unavailable',
        };
      }
      downloadUrl = resolved;
    } else {
      logger.info(
        `${LOG_PREFIX}: private/HIPAA URL detected, using authenticated VAPI artifact download`,
        { conversationId: row.id, vapiCallId },
      );
    }

    const s3Url = await persistCallRecordingToS3(
      downloadUrl,
      row.hotel_id,
      row.conversation_session_id,
      vapiCallId,
      { vapiApiKey },
    );

    if (!s3Url.startsWith('s3://')) {
      throw new Error(
        `Expected s3:// URL after upload, got ${s3Url.slice(0, 80)}`,
      );
    }

    await knex('conversations').where({ id: row.id }).update({
      recording_url: s3Url,
      updated_at: knex.fn.now(),
    });

    logger.info(
      `${LOG_PREFIX}: migrated conversationId=${row.id} vapiCallId=${vapiCallId} → ${s3Url}`,
    );

    return {
      conversationId: row.id,
      vapiCallId,
      status: 'uploaded',
      recordingUrl: s3Url,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(
      `${LOG_PREFIX}: failed conversationId=${row.id} vapiCallId=${vapiCallId} error=${errorMessage}`,
      { err, conversationId: row.id, vapiCallId },
    );
    return {
      conversationId: row.id,
      vapiCallId,
      status: 'failed',
      error: errorMessage,
    };
  }
}

async function processBackfillRow(
  knex: Knex,
  row: BackfillRow,
  vapiApiKey: string,
  stats: MutableBackfillStats,
): Promise<void> {
  const result = await migrateBackfillRow(knex, row, vapiApiKey);

  if (result.status === 'uploaded') {
    stats.uploaded++;
  } else if (result.status === 'skipped') {
    stats.skipped++;
  } else {
    stats.failed++;
  }
}

export class RecordingBackfillService {
  constructor(private readonly hotels: HotelService = hotelService) {}

  async backfillHotelDay(
    params: RecordingBackfillParams,
  ): Promise<RecordingBackfillStats> {
    const { hotelId, date } = params;

    if (!config.S3_BUCKET) {
      throw new Error('S3_BUCKET is not configured');
    }

    const vapiApiKey = resolveVapiApiKeyForBackfill();
    const hotel = await this.hotels.getHotelById(hotelId);

    if (!hotel.timezone) {
      throw new Error(`Hotel ${hotelId} has no timezone configured`);
    }

    const dayStart = dayjs.tz(date, hotel.timezone).startOf('day');
    const dayEnd = dayjs.tz(date, hotel.timezone).endOf('day');

    if (!dayStart.isValid()) {
      throw new Error(`Invalid date: ${date}`);
    }

    logger.info(
      `${LOG_PREFIX}: start hotelId=${hotelId} date=${date} timezone=${hotel.timezone} ` +
        `window=${dayStart.toISOString()} → ${dayEnd.toISOString()}`,
    );

    const rows = await loadLegacyRecordingRowsForHotelDay(db, hotelId, date);

    logger.info(
      `${LOG_PREFIX}: loaded ${rows.length} conversation(s) with legacy https recording URLs`,
    );

    const stats: MutableBackfillStats = {
      uploaded: 0,
      skipped: 0,
      failed: 0,
    };

    for (const row of rows) {
      await processBackfillRow(db, row, vapiApiKey, stats);
    }

    const result: RecordingBackfillStats = {
      hotelId,
      date,
      timezone: hotel.timezone,
      total: rows.length,
      uploaded: stats.uploaded,
      skipped: stats.skipped,
      failed: stats.failed,
    };

    logger.info(`${LOG_PREFIX}: done`, result);

    return result;
  }

  /**
   * Backfill one calendar day per hotel, processing all hotels sequentially.
   */
  async backfillAllHotelsForDate(params: {
    date: string;
  }): Promise<RecordingBackfillAllHotelsResult> {
    const { date } = params;

    resolveVapiApiKeyForBackfill();
    if (!config.S3_BUCKET) {
      throw new Error('S3_BUCKET is not configured');
    }

    const hotels = await this.hotels.getHotels();

    logger.info(
      `${LOG_PREFIX}: start all-hotels date=${date} hotelCount=${hotels.length}`,
    );

    const hotelResults: RecordingBackfillStats[] = [];

    for (let i = 0; i < hotels.length; i++) {
      const hotel = hotels[i];
      logger.info(
        `${LOG_PREFIX}: hotel ${i + 1}/${hotels.length} id=${hotel.id} name=${hotel.name}`,
      );

      try {
        const stats = await this.backfillHotelDay({
          hotelId: hotel.id,
          date,
        });
        hotelResults.push(stats);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          `${LOG_PREFIX}: hotel ${hotel.id} failed, continuing with next`,
          { err },
        );
        hotelResults.push({
          hotelId: hotel.id,
          date,
          timezone: hotel.timezone ?? 'unknown',
          total: 0,
          uploaded: 0,
          skipped: 0,
          failed: 0,
          error: message,
        });
      }
    }

    const totals = hotelResults.reduce(
      (acc, r) => ({
        total: acc.total + r.total,
        uploaded: acc.uploaded + r.uploaded,
        skipped: acc.skipped + r.skipped,
        failed: acc.failed + r.failed,
      }),
      { total: 0, uploaded: 0, skipped: 0, failed: 0 },
    );

    const result: RecordingBackfillAllHotelsResult = {
      date,
      hotelsProcessed: hotels.length,
      hotelResults,
      totals,
    };

    logger.info(`${LOG_PREFIX}: all-hotels done`, result);

    return result;
  }

  /**
   * Backfill a single conversation by ID. Useful for retrying manual failures.
   */
  async backfillConversation(
    conversationId: string,
  ): Promise<RecordingBackfillConversationResult> {
    if (!config.S3_BUCKET) {
      throw new Error('S3_BUCKET is not configured');
    }

    const vapiApiKey = resolveVapiApiKeyForBackfill();
    const row = await loadBackfillRowByConversationId(db, conversationId);

    if (!row) {
      throw new NoDataError(`Conversation not found: ${conversationId}`);
    }

    if (!row.recording_url) {
      return {
        conversationId,
        status: 'skipped',
        reason: 'conversation has no recording_url',
      };
    }

    return migrateBackfillRow(db, row, vapiApiKey);
  }
}

export const recordingBackfillService = new RecordingBackfillService();
