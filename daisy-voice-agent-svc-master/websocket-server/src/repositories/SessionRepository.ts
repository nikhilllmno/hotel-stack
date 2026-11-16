import { Knex } from 'knex';
import {
  HotelAnalyticsSummary,
  SessionLog,
  SessionMetadata,
} from '../dtos/Session';
import {
  KpiRawCounts,
  KpiTrendRateRow,
  KpiTrendRevenueRow,
} from '../dtos/dashboard/callKpiSummary';
import { ConversationSummary } from '../dtos/dashboard/callSummary';
import { ChatRoutingMode } from '../dtos/enum/ChatRoutingMode';
import { ConversationMessageRole } from '../dtos/enum/ConversationMessageRole';
import { ReservationStatus } from '../dtos/enum/ReservationStatus';
import { SessionType } from '../dtos/enum/SessionType';
import { Session } from '../models/Session';
import { StatusUpdateType } from '../models/request/StatusUpdate';
import { convertToPhoneNumber } from '../utils/helper';
import logger from '../utils/logger';
import { BaseRepository } from './BaseRepository';

export class SessionRepository extends BaseRepository {
  private readonly tableName = 'sessions';

  private applyIntentFilter(qb: Knex.QueryBuilder, intent?: string): void {
    if (!intent) return;
    const intents = intent
      .split(',')
      .map((i) => i.trim())
      .filter(Boolean);
    if (intents.length === 1) {
      qb.andWhere('conversations.intent', 'like', `%${intents[0]}%`);
    } else if (intents.length > 1) {
      qb.andWhere((sub) => {
        for (const i of intents) {
          sub.orWhere('conversations.intent', 'like', `%${i}%`);
        }
      });
    }
  }

  async findSessionByHotelIdStatusType(
    hotelId: string,
    callerPhoneNumber: string,
    session_status: StatusUpdateType,
    session_type: SessionType,
  ): Promise<Session | null> {
    const digits = (
      convertToPhoneNumber(callerPhoneNumber) ?? callerPhoneNumber
    ).replace(/\D/g, '');
    const session = await this.db<Session>(this.tableName)
      .where({
        hotel_id: hotelId,
        session_status,
        session_type,
      })
      .whereRaw("regexp_replace(caller_phone_number, '[^0-9]', '', 'g') = ?", [
        digits,
      ])
      .orderBy('created_at', 'desc')
      .first();
    return session || null;
  }

  /**
   * Latest non-ended session for a hotel + caller + type (digit-normalized match).
   * Matches SMS inbox semantics: session_status != Ended.
   */
  async findLatestNonEndedSessionByHotelAndCaller(
    hotelId: string,
    callerPhoneNumber: string,
    sessionType: SessionType,
  ): Promise<Session | null> {
    const digits = (
      convertToPhoneNumber(callerPhoneNumber) ?? callerPhoneNumber
    ).replace(/\D/g, '');
    const session = await this.db<Session>(this.tableName)
      .where({
        hotel_id: hotelId,
        session_type: sessionType,
      })
      .whereNot('session_status', StatusUpdateType.Ended)
      .whereRaw("regexp_replace(caller_phone_number, '[^0-9]', '', 'g') = ?", [
        digits,
      ])
      // Postgres DESC defaults to NULLS FIRST; match SMS inbox (NULLS LAST).
      .orderBy([{ column: 'last_messaged_at', order: 'desc', nulls: 'last' }])
      .orderBy('created_at', 'desc')
      .first();
    return session || null;
  }

  async findSessionByExternalId(call_id: string): Promise<Session | null> {
    const session = await this.db<Session>(this.tableName)
      .where({ external_provider_id: call_id })
      .orderBy('created_at', 'desc')
      .first();
    return session || null;
  }

  async findSessionById(id: string): Promise<Session | null> {
    const session = await this.db<Session>(this.tableName)
      .where({ id })
      .first();
    return session || null;
  }

  async insertSession(
    session: Partial<Session>,
    transaction?: Knex.Transaction,
  ): Promise<Session> {
    const trx = transaction ?? this.db;
    const [insertedSession] = await trx<Session>(this.tableName)
      .insert(session)
      .returning('*');
    return insertedSession;
  }

  async updateSession(
    id: string,
    session: Partial<Session>,
  ): Promise<Session | null> {
    const [updatedSession] = await this.db<Session>(this.tableName)
      .where({ id })
      .update(session)
      .returning('*');
    return updatedSession || null;
  }

  /**
   * Bump activity time on a session after a conversation_messages row is inserted.
   * Incoming guest (USER) messages also set has_unread_messages for SMS operator inbox.
   */
  async updateSessionAfterMessaging(
    sessionId: string,
    messageRole: ConversationMessageRole,
    /** When set, bulk path: true if any message in the batch was USER (unread semantics). Omit for single-message behavior from messageRole. */
    extras?: { hasUserMessageInBatch?: boolean },
  ): Promise<void> {
    const db = this.db;
    const now = new Date();
    const patch: Partial<Session> = {
      last_messaged_at: now,
      updated_at: now,
    };
    if (extras?.hasUserMessageInBatch !== undefined) {
      if (extras.hasUserMessageInBatch) {
        patch.has_unread_messages = true;
      }
    } else if (messageRole === ConversationMessageRole.USER) {
      patch.has_unread_messages = true;
    }
    await db<Session>(this.tableName).where({ id: sessionId }).update(patch);
  }

  /** SMS operator inbox: clear has_unread_messages when the thread is opened / marked read. */
  async clearSmsInboxUnreadFlag(sessionId: string): Promise<Session | null> {
    return this.updateSession(sessionId, {
      has_unread_messages: false,
      updated_at: new Date(),
    });
  }

  /** Set AI or DIRECT routing mode for a session. */
  async setChatRouting(
    sessionId: string,
    mode: ChatRoutingMode,
  ): Promise<void> {
    await this.db<Session>(this.tableName).where({ id: sessionId }).update({
      chat_routing_mode: mode,
      chat_routing_updated_at: new Date(),
      updated_at: new Date(),
    });
  }

  async getSessionsSummaryByHotelId(
    hotel_id: string,
    start_date?: Date,
    end_date?: Date,
    session_type?: SessionType,
  ): Promise<ConversationSummary> {
    session_type = session_type || SessionType.CALL;
    const query = this.db<Session>(this.tableName)
      .innerJoin('hotels', 'hotels.id', 'sessions.hotel_id')
      .innerJoin(
        'conversations',
        'conversations.conversation_session_id',
        'sessions.id',
      )
      .where('hotels.id', hotel_id)
      .modify((qb) => {
        if (start_date && end_date) {
          qb.andWhere('sessions.created_at', '>=', start_date.toISOString());
          qb.andWhere('sessions.created_at', '<=', end_date.toISOString());
        }
        qb.andWhere('sessions.session_type', '=', session_type);
      })
      .whereNotNull('conversations.ended_at');

    const countPromise = await query
      .clone()
      .countDistinct('sessions.id as count')
      .first();
    const durationPromise = await query
      .clone()
      .select(
        this.db.raw(`
        SUM(EXTRACT(EPOCH FROM (conversations.ended_at - conversations.started_at)))
        as total_duration
      `),
      )
      .first();

    const [count, duration] = await Promise.all([
      countPromise,
      durationPromise,
    ]);

    return {
      total_conversations: Number(count?.count || 0),
      total_duration: Number(duration?.total_duration || 0),
    };
  }

  async getTotalCallLogCount(
    hotel_id: string,
    start_date: Date,
    end_date: Date,
    phone_number?: string,
    session_type?: SessionType,
    intent?: string,
  ): Promise<number> {
    session_type = session_type || SessionType.CALL;
    const query = this.db<Session>(this.tableName)
      .join('hotels', 'hotels.id', 'sessions.hotel_id')
      .join(
        'conversations',
        'conversations.conversation_session_id',
        'sessions.id',
      )
      .where('hotels.id', hotel_id)
      .andWhere('sessions.session_type', '=', session_type)
      .modify((qb) => {
        if (phone_number) {
          qb.andWhere(
            'sessions.caller_phone_number',
            'like',
            `%${phone_number}%`,
          );
        }
        if (start_date && end_date) {
          qb.andWhere('sessions.created_at', '>=', start_date.toISOString());
          qb.andWhere('sessions.created_at', '<=', end_date.toISOString());
        }
        this.applyIntentFilter(qb, intent);
      })
      .whereNotNull('conversations.ended_at')
      .countDistinct('sessions.id as count')
      .first();

    try {
      const count = await query;
      return Number(count?.count) || 0;
    } catch (error) {
      logger.error(
        `Failed to execute query: ${query.toQuery()}. Error: ${JSON.stringify(
          error,
        )}`,
      );
      throw error;
    }
  }

  async getPaginatedSessionData(
    hotel_id: string,
    start_date: Date,
    end_date: Date,
    offset: number = 0,
    limit: number = 10,
    phone_number?: string,
    session_type?: SessionType,
    intent?: string,
  ): Promise<SessionLog[] | null> {
    if (end_date && start_date && end_date < start_date) {
      throw new Error('Invalid date range');
    }
    session_type = session_type || SessionType.CALL;
    const query = this.db(this.tableName)
      .join('hotels', 'hotels.id', 'sessions.hotel_id')
      .join(
        'conversations',
        'conversations.conversation_session_id',
        'sessions.id',
      )
      .where('hotels.id', hotel_id)
      .andWhere('sessions.session_type', '=', session_type)
      .modify((qb) => {
        if (phone_number) {
          qb.where('sessions.caller_phone_number', 'like', `%${phone_number}%`);
        }
        if (start_date && end_date) {
          qb.andWhere('sessions.created_at', '>=', start_date.toISOString());
          qb.andWhere('sessions.created_at', '<=', end_date.toISOString());
        }
        this.applyIntentFilter(qb, intent);
      })
      .whereNotNull('conversations.ended_at')
      .select(
        // sessions
        'sessions.id',
        'sessions.caller_phone_number',
        'sessions.created_at',
        'sessions.updated_at',
        // conversations
        'conversations.started_at',
        'conversations.ended_at',
        'conversations.cost',
        'conversations.intent',
      )
      .orderBy('sessions.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    try {
      logger.info(`Executing query: ${query.toQuery()}`);
      const session: SessionLog[] = await query;

      return session || null;
    } catch (error) {
      logger.error(
        `Failed to execute query: ${query.toQuery()}. Error: ${JSON.stringify(
          error,
        )}`,
      );
      throw error;
    }
  }

  /**
   * Count distinct caller_phone_number for active SMS sessions (not ended).
   * @param search Optional substring to match against caller_phone_number (case-insensitive).
   */
  async countDistinctActiveSmsSessionsByHotelId(
    hotelId: string,
    search?: string | null,
  ): Promise<number> {
    const trimmed = search?.trim() || '';
    const params: (string | number)[] = [
      hotelId,
      SessionType.SMS,
      StatusUpdateType.Ended,
    ];
    const phoneFilter = trimmed ? ' AND caller_phone_number ILIKE ?' : '';
    if (trimmed) {
      params.push(`%${trimmed}%`);
    }
    const row = await this.db.raw(
      `
      SELECT COUNT(*)::bigint AS c
      FROM (
        SELECT DISTINCT caller_phone_number
        FROM sessions
        WHERE hotel_id = ?
          AND session_type = ?
          AND session_status != ?
          ${phoneFilter}
      ) t
      `,
      params,
    );
    const c = row.rows?.[0]?.c ?? row[0]?.c;
    return Number(c ?? 0);
  }

  /**
   * Merge a partial metadata patch into the existing session metadata JSONB column.
   * Uses Postgres `||` operator so existing keys not in the patch are preserved.
   */
  async updateSessionMetadata(
    sessionId: string,
    patch: SessionMetadata,
  ): Promise<void> {
    await this.db(this.tableName)
      .where({ id: sessionId })
      .update({
        metadata: this.db.raw(`COALESCE(metadata, '{}'::jsonb) || ?::jsonb`, [
          JSON.stringify(patch),
        ]),
        updated_at: new Date(),
      });
  }

  /**
   * One row per distinct caller (latest activity per phone wins), paginated by last_messaged_at desc.
   * @param search Optional substring to match against caller_phone_number (case-insensitive).
   */
  async findDistinctActiveSmsSessionsPaginated(
    hotelId: string,
    limit: number,
    offset: number,
    search?: string | null,
  ): Promise<Session[]> {
    const trimmed = search?.trim() || '';
    const params: (string | number)[] = [
      hotelId,
      SessionType.SMS,
      StatusUpdateType.Ended,
    ];
    const phoneFilter = trimmed ? ' AND caller_phone_number ILIKE ?' : '';
    if (trimmed) {
      params.push(`%${trimmed}%`);
    }
    params.push(limit, offset);
    const result = await this.db.raw(
      `
      SELECT * FROM (
        SELECT DISTINCT ON (caller_phone_number)
          id,
          caller_phone_number,
          assistant_phone_number,
          session_status,
          session_type,
          hotel_id,
          created_at,
          updated_at,
          last_messaged_at,
          has_unread_messages
        FROM sessions
        WHERE hotel_id = ?
          AND session_type = ?
          AND session_status != ?
          ${phoneFilter}
        ORDER BY caller_phone_number, last_messaged_at DESC NULLS LAST
      ) sub
      ORDER BY sub.last_messaged_at DESC NULLS LAST
      LIMIT ? OFFSET ?
      `,
      params,
    );
    const rows = result.rows ?? result;
    return rows as Session[];
  }

  /**
   * For each hotel, count total completed calls and per-metric breakdowns in a date range.
   * When hotelIds is provided, results are limited to those hotels.
   *
   * LEFT JOINs reservations → payment_reservations → payments so we can also
   * detect sessions where a payment link was sent AND a reservation payment completed.
   */
  async getAnalyticsSummaryByHotel(
    startDate: Date,
    endDate: Date,
    hotelIds?: string[],
  ): Promise<HotelAnalyticsSummary[]> {
    const params: any[] = [
      SessionType.CALL,
      StatusUpdateType.Ended,
      startDate.toISOString(),
      endDate.toISOString(),
    ];
    let hotelFilter = '';
    if (hotelIds && hotelIds.length > 0) {
      const placeholders = hotelIds.map(() => '?').join(', ');
      hotelFilter = ` AND sessions.hotel_id IN (${placeholders})`;
      params.push(...hotelIds);
    }

    const result = await this.db.raw(
      `
      SELECT
        sessions.hotel_id,
        COUNT(DISTINCT sessions.id)::int AS total_calls,
        COUNT(DISTINCT CASE
          WHEN sessions.metadata->>'availability_enquired' = 'true' THEN sessions.id
        END)::int AS availability_enquired_calls,
        COUNT(DISTINCT CASE
          WHEN sessions.metadata->>'payment_link_sent' = 'true' THEN sessions.id
        END)::int AS payment_link_sent_calls,
        COUNT(DISTINCT CASE
          WHEN sessions.metadata->>'payment_link_sent' = 'true'
            AND payments.payment_status = 'COMPLETED'
          THEN sessions.id
        END)::int AS successful_reservation_calls,
        ROUND(
          AVG(
            NULLIF(sessions.metadata->>'customer_satisfaction_score', '')::numeric
          ),
          1
        )::float8 AS avg_satisfaction_score,
        COUNT(DISTINCT CASE
          WHEN NULLIF(sessions.metadata->>'customer_frustration_score', '')::numeric > 7
          THEN sessions.id
        END)::int AS high_frustration_calls
      FROM sessions
      LEFT JOIN reservations ON reservations.session_id = sessions.id
      LEFT JOIN payment_reservations ON payment_reservations.reservation_id = reservations.id
      LEFT JOIN payments ON payments.id = payment_reservations.payment_id
      WHERE sessions.session_type = ?
        AND sessions.session_status = ?
        AND sessions.created_at >= ?
        AND sessions.created_at <= ?
        ${hotelFilter}
      GROUP BY sessions.hotel_id
      `,
      params,
    );

    return (result.rows ?? result) as HotelAnalyticsSummary[];
  }

  /**
   * Single CTE query that returns raw counts for all 7 KPI summary metrics.
   * Ratios are computed in the service layer.
   */
  async getKpiSummary(
    hotelId: string,
    startDate: Date,
    endDate: Date,
    reservationStatuses: ReservationStatus[] = [
      ReservationStatus.ACTIVE,
      ReservationStatus.NO_SHOW,
    ],
  ): Promise<KpiRawCounts> {
    const includeCancelled = reservationStatuses.includes(
      ReservationStatus.CANCELLED,
    );
    const nonCancelledStatuses = reservationStatuses.filter(
      (s) => s !== ReservationStatus.CANCELLED,
    );
    const statusCondition = [
      nonCancelledStatuses.length
        ? `r.status IN (${nonCancelledStatuses.map((s) => `'${s}'`).join(', ')})`
        : null,
      includeCancelled
        ? `(r.status = '${ReservationStatus.CANCELLED}' AND r.previous_status = '${ReservationStatus.ACTIVE}')`
        : null,
    ]
      .filter(Boolean)
      .join(' OR ');

    const result = await this.db.raw(
      `
      WITH date_range_calls AS (
        SELECT s.id, c.intent,
               (s.metadata->>'call_forwarded')::boolean AS forwarded
        FROM sessions s
        INNER JOIN conversations c ON c.conversation_session_id = s.id
        WHERE s.hotel_id = ?
          AND s.session_type = ?
          AND s.session_status = ?
          AND c.ended_at IS NOT NULL
          AND s.created_at BETWEEN ? AND ?
      ),
      meaningful AS (
        SELECT id, forwarded FROM date_range_calls
        WHERE intent ~ 'NEW_RESERVATION|MODIFY_RESERVATION|CANCEL_RESERVATION|ENQUIRY'
      ),
      escalated_sessions AS (
        SELECT DISTINCT session_id FROM escalations
        WHERE session_id IN (SELECT id FROM date_range_calls)
      ),
      successful_bookings AS (
        SELECT DISTINCT
          r.session_id,
          SPLIT_PART(r.booking_id, '_', 1) AS parent_booking_id
        FROM reservations r
        INNER JOIN sessions s ON s.id = r.session_id
        WHERE r.hotel_id = ?
          AND (${statusCondition})
          AND r.type = ?
          AND r.created_at BETWEEN ? AND ?
          AND s.session_type = ?
          AND s.session_status = ?
          AND s.created_at BETWEEN ? AND ?
      ),
      room_stats AS (
        SELECT
          SUM((r.check_out::date - r.check_in::date)) AS room_nights,
          SUM(q.base_rate + q.taxes + q.fees) AS total_revenue
        FROM reservations r
        INNER JOIN quotes q ON q.reservation_id = r.id
        WHERE r.hotel_id = ?
          AND (${statusCondition})
          AND r.type = ?
          AND r.created_at BETWEEN ? AND ?
      )
      SELECT
        (SELECT COUNT(*) FROM date_range_calls)::int                          AS total_calls,
        (SELECT COUNT(*) FROM meaningful)::int                                AS meaningful_calls,
        (SELECT COUNT(*) FROM date_range_calls
          WHERE intent LIKE '%NEW_RESERVATION%')::int                         AS booking_intent_calls,
        (SELECT COUNT(DISTINCT sb.parent_booking_id)
          FROM successful_bookings sb
          INNER JOIN date_range_calls dc ON dc.id = sb.session_id
          WHERE dc.intent LIKE '%NEW_RESERVATION%')::int                      AS booking_intent_conversions,
        (SELECT COUNT(DISTINCT parent_booking_id)
          FROM successful_bookings)::int                                       AS total_conversions,
        (SELECT COUNT(*) FROM date_range_calls dc
          WHERE EXISTS (SELECT 1 FROM escalated_sessions es WHERE es.session_id = dc.id)
            OR dc.forwarded = true)::int                                      AS total_escalated,
        (SELECT COUNT(*) FROM meaningful m
          WHERE NOT EXISTS (SELECT 1 FROM escalated_sessions es WHERE es.session_id = m.id)
            AND m.forwarded IS NOT TRUE)::int                                 AS resolved_meaningful,
        (SELECT COUNT(*) FROM date_range_calls dc WHERE dc.forwarded = true)::int AS forwarded_calls,
        (SELECT COUNT(*) FROM meaningful m WHERE m.forwarded IS NOT TRUE)::int  AS resolved_meaningful_fwd,
        (SELECT COUNT(*) FROM date_range_calls dc
          WHERE dc.intent LIKE '%NEW_RESERVATION%'
            AND (EXISTS (SELECT 1 FROM escalated_sessions es WHERE es.session_id = dc.id)
              OR dc.forwarded = true))::int                                   AS new_reservation_escalated,
        (SELECT COUNT(*) FROM date_range_calls
          WHERE intent LIKE '%NEW_RESERVATION%')::int                         AS new_reservation_calls,
        COALESCE((SELECT room_nights FROM room_stats), 0)::float8              AS room_nights,
        COALESCE((SELECT total_revenue FROM room_stats), 0)::float8            AS total_revenue
      `,
      [
        hotelId,
        SessionType.CALL,
        StatusUpdateType.Ended,
        startDate.toISOString(),
        endDate.toISOString(),
        hotelId,
        SessionType.CALL,
        startDate.toISOString(),
        endDate.toISOString(),
        SessionType.CALL,
        StatusUpdateType.Ended,
        startDate.toISOString(),
        endDate.toISOString(),
        hotelId,
        SessionType.CALL,
        startDate.toISOString(),
        endDate.toISOString(),
      ],
    );

    const row = (result.rows ?? result)[0] ?? {};
    return {
      total_calls: Number(row.total_calls ?? 0),
      meaningful_calls: Number(row.meaningful_calls ?? 0),
      booking_intent_calls: Number(row.booking_intent_calls ?? 0),
      booking_intent_conversions: Number(row.booking_intent_conversions ?? 0),
      total_conversions: Number(row.total_conversions ?? 0),
      total_escalated: Number(row.total_escalated ?? 0),
      resolved_meaningful: Number(row.resolved_meaningful ?? 0),
      forwarded_calls: Number(row.forwarded_calls ?? 0),
      resolved_meaningful_fwd: Number(row.resolved_meaningful_fwd ?? 0),
      new_reservation_escalated: Number(row.new_reservation_escalated ?? 0),
      new_reservation_calls: Number(row.new_reservation_calls ?? 0),
      room_nights: Number(row.room_nights ?? 0),
      total_revenue: Number(row.total_revenue ?? 0),
    };
  }

  /**
   * Day-bucketed call rate metrics for the trend graphs
   * (sessions + conversations + escalations).
   * Days are grouped by hotel-local calendar date (hotels.timezone).
   */
  async getKpiTrendRates(
    hotelId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<KpiTrendRateRow[]> {
    const result = await this.db.raw(
      `
      SELECT
        DATE_TRUNC('day', s.created_at AT TIME ZONE h.timezone)::date AS day,
        COUNT(DISTINCT s.id)::int AS total_calls,
        COUNT(DISTINCT CASE
          WHEN c.intent ~ 'NEW_RESERVATION|MODIFY_RESERVATION|CANCEL_RESERVATION|ENQUIRY'
          THEN s.id END)::int AS meaningful_calls,
        COUNT(DISTINCT CASE
          WHEN c.intent LIKE '%NEW_RESERVATION%' THEN s.id
        END)::int AS new_reservation_calls,
        COUNT(DISTINCT CASE
          WHEN EXISTS (SELECT 1 FROM escalations e WHERE e.session_id = s.id)
            OR (s.metadata->>'call_forwarded')::boolean = true
          THEN s.id END)::int AS escalated_calls,
        COUNT(DISTINCT CASE
          WHEN (s.metadata->>'call_forwarded')::boolean = true
          THEN s.id END)::int AS forwarded_calls,
        COUNT(DISTINCT CASE
          WHEN c.intent ~ 'NEW_RESERVATION|MODIFY_RESERVATION|CANCEL_RESERVATION|ENQUIRY'
            AND NOT EXISTS (SELECT 1 FROM escalations e WHERE e.session_id = s.id)
            AND (s.metadata->>'call_forwarded')::boolean IS NOT TRUE
          THEN s.id END)::int AS resolved_meaningful_calls,
        COUNT(DISTINCT CASE
          WHEN c.intent ~ 'NEW_RESERVATION|MODIFY_RESERVATION|CANCEL_RESERVATION|ENQUIRY'
            AND (s.metadata->>'call_forwarded')::boolean IS NOT TRUE
          THEN s.id END)::int AS resolved_meaningful_fwd_calls,
        COUNT(DISTINCT CASE
          WHEN c.intent LIKE '%NEW_RESERVATION%'
            AND NOT EXISTS (SELECT 1 FROM escalations e WHERE e.session_id = s.id)
            AND (s.metadata->>'call_forwarded')::boolean IS NOT TRUE
          THEN s.id END)::int AS resolved_new_reservation_calls
      FROM sessions s
      INNER JOIN conversations c ON c.conversation_session_id = s.id
      INNER JOIN hotels h ON h.id = s.hotel_id
      WHERE s.hotel_id = ?
        AND s.session_type = ?
        AND s.session_status = ?
        AND c.ended_at IS NOT NULL
        AND s.created_at BETWEEN ? AND ?
      GROUP BY DATE_TRUNC('day', s.created_at AT TIME ZONE h.timezone)::date
      ORDER BY day
      `,
      [
        hotelId,
        SessionType.CALL,
        StatusUpdateType.Ended,
        startDate.toISOString(),
        endDate.toISOString(),
      ],
    );

    return (result.rows ?? result).map((row: any) => ({
      day:
        row.day instanceof Date
          ? row.day.toISOString().slice(0, 10)
          : String(row.day).slice(0, 10),
      total_calls: Number(row.total_calls ?? 0),
      meaningful_calls: Number(row.meaningful_calls ?? 0),
      new_reservation_calls: Number(row.new_reservation_calls ?? 0),
      escalated_calls: Number(row.escalated_calls ?? 0),
      forwarded_calls: Number(row.forwarded_calls ?? 0),
      resolved_meaningful_calls: Number(row.resolved_meaningful_calls ?? 0),
      resolved_meaningful_fwd_calls: Number(
        row.resolved_meaningful_fwd_calls ?? 0,
      ),
      resolved_new_reservation_calls: Number(
        row.resolved_new_reservation_calls ?? 0,
      ),
    }));
  }

  /**
   * Day-bucketed revenue metrics for the trend graphs
   * (reservations + quotes + payments).
   * Days are grouped by hotel-local calendar date (hotels.timezone).
   */
  async getKpiTrendRevenue(
    hotelId: string,
    startDate: Date,
    endDate: Date,
    reservationStatuses: ReservationStatus[] = [
      ReservationStatus.ACTIVE,
      ReservationStatus.NO_SHOW,
    ],
  ): Promise<KpiTrendRevenueRow[]> {
    const includeCancelled = reservationStatuses.includes(
      ReservationStatus.CANCELLED,
    );
    const nonCancelledStatuses = reservationStatuses.filter(
      (s) => s !== ReservationStatus.CANCELLED,
    );
    const statusCondition = [
      nonCancelledStatuses.length
        ? `r.status IN (${nonCancelledStatuses.map((s) => `'${s}'`).join(', ')})`
        : null,
      includeCancelled
        ? `(r.status = '${ReservationStatus.CANCELLED}' AND r.previous_status = '${ReservationStatus.ACTIVE}')`
        : null,
    ]
      .filter(Boolean)
      .join(' OR ');

    const result = await this.db.raw(
      `
      WITH revenue_by_day AS (
        SELECT
          DATE_TRUNC('day', r.created_at AT TIME ZONE h.timezone)::date AS day,
          COUNT(DISTINCT SPLIT_PART(r.booking_id, '_', 1))::int AS converted_calls,
          SUM((r.check_out::date - r.check_in::date))::float8 AS room_nights,
          SUM(q.base_rate + q.taxes + q.fees)::float8 AS total_revenue
        FROM reservations r
        INNER JOIN quotes q ON q.reservation_id = r.id
        INNER JOIN hotels h ON h.id = r.hotel_id
        WHERE r.hotel_id = ?
          AND (${statusCondition})
          AND r.type = ?
          AND r.created_at BETWEEN ? AND ?
        GROUP BY DATE_TRUNC('day', r.created_at AT TIME ZONE h.timezone)::date
      ),
      booking_intent_by_day AS (
        SELECT
          DATE_TRUNC('day', r.created_at AT TIME ZONE h.timezone)::date AS day,
          COUNT(DISTINCT SPLIT_PART(r.booking_id, '_', 1))::int AS booking_intent_conversions
        FROM reservations r
        INNER JOIN sessions s ON s.id = r.session_id
        INNER JOIN conversations c ON c.conversation_session_id = s.id
        INNER JOIN hotels h ON h.id = r.hotel_id
        WHERE r.hotel_id = ?
          AND (${statusCondition})
          AND r.type = ?
          AND r.created_at BETWEEN ? AND ?
          AND c.intent LIKE '%NEW_RESERVATION%'
        GROUP BY DATE_TRUNC('day', r.created_at AT TIME ZONE h.timezone)::date
      ),
      payments_by_day AS (
        SELECT
          DATE_TRUNC('day', r.created_at AT TIME ZONE h.timezone)::date AS day,
          SUM(COALESCE(
            (p.amount_charged::numeric - p.amount_refunded::numeric), 0
          ))::float8 AS advance_collected
        FROM reservations r
        INNER JOIN hotels h ON h.id = r.hotel_id
        INNER JOIN payment_reservations pr ON pr.reservation_id = r.id
        INNER JOIN payments p ON p.id = pr.payment_id
          AND p.payment_status IN ('COMPLETED', 'REFUNDED', 'REFUND_FAILED')
        WHERE r.hotel_id = ?
          AND (${statusCondition})
          AND r.type = ?
          AND r.created_at BETWEEN ? AND ?
        GROUP BY DATE_TRUNC('day', r.created_at AT TIME ZONE h.timezone)::date
      )
      SELECT
        COALESCE(rev.day, bi.day, pay.day) AS day,
        COALESCE(rev.converted_calls, 0) AS converted_calls,
        COALESCE(bi.booking_intent_conversions, 0) AS booking_intent_conversions,
        COALESCE(rev.room_nights, 0) AS room_nights,
        COALESCE(rev.total_revenue, 0) AS total_revenue,
        COALESCE(pay.advance_collected, 0) AS advance_collected
      FROM revenue_by_day rev
      FULL OUTER JOIN booking_intent_by_day bi ON rev.day = bi.day
      FULL OUTER JOIN payments_by_day pay ON COALESCE(rev.day, bi.day) = pay.day
      ORDER BY day
      `,
      [
        hotelId,
        SessionType.CALL,
        startDate.toISOString(),
        endDate.toISOString(),
        hotelId,
        SessionType.CALL,
        startDate.toISOString(),
        endDate.toISOString(),
        hotelId,
        SessionType.CALL,
        startDate.toISOString(),
        endDate.toISOString(),
      ],
    );

    return (result.rows ?? result).map((row: any) => ({
      day:
        row.day instanceof Date
          ? row.day.toISOString().slice(0, 10)
          : String(row.day).slice(0, 10),
      converted_calls: Number(row.converted_calls ?? 0),
      booking_intent_conversions: Number(row.booking_intent_conversions ?? 0),
      room_nights: Number(row.room_nights ?? 0),
      total_revenue: Number(row.total_revenue ?? 0),
      advance_collected: Number(row.advance_collected ?? 0),
    }));
  }
}
