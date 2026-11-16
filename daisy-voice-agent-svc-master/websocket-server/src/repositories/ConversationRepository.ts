import { Knex } from 'knex';
import { ConversationSummary } from '../dtos/dashboard/conversationSummary';
import { SessionType } from '../dtos/enum/SessionType';
import { Conversation, ConversationWithMessages } from '../models/Conversation';

import { BaseRepository } from './BaseRepository';

export class ConversationRepository extends BaseRepository {
  private tableName = 'conversations';

  async create(
    data: Omit<Conversation, 'id' | 'created_at' | 'updated_at'>,
    trx?: any,
  ): Promise<Conversation> {
    const dbOrTrx = trx || this.db;
    const [result] = await dbOrTrx(this.tableName).insert(data).returning('*');
    return result;
  }

  async findById(id: string): Promise<ConversationWithMessages | null> {
    const result = await this.db(this.tableName).where({ id }).first();
    return result || null;
  }

  async update(
    id: string,
    data: Partial<Omit<Conversation, 'id' | 'created_at' | 'updated_at'>>,
  ): Promise<Conversation | null> {
    const updateData = { ...data };
    if (updateData.ended_at) {
      updateData.ended_at = new Date();
    }
    const [result] = await this.db(this.tableName)
      .where({ id })
      .update(updateData)
      .returning('*');
    return result || null;
  }

  async delete(id: string): Promise<boolean> {
    const count = await this.db(this.tableName).where({ id }).delete();
    return count > 0;
  }

  async getConversationBySessionId(
    conversation_session_id: string,
  ): Promise<Conversation | null> {
    const result = await this.db<Conversation>(this.tableName)
      .where({ conversation_session_id })
      .orderBy('created_at', 'desc')
      .first();
    return result || null;
  }

  async getConversationSummaryBySessionId(
    conversation_session_id: string,
  ): Promise<ConversationSummary> {
    const result = await this.db<Conversation>(this.tableName)
      .where({ conversation_session_id })
      .select('conversations.summary', 'conversations.recording_url')
      .first();
    return { summary: result?.summary, recording_url: result?.recording_url };
  }

  async getConversationIntentByHotelId(
    hotel_id: string,
    start_date?: Date,
    end_date?: Date,
    session_type?: SessionType,
  ): Promise<string[]> {
    const result = await this.getIntentFilterQuery<Conversation>(
      this.db<Conversation>(this.tableName),
      hotel_id,
      start_date,
      end_date,
      session_type,
    )
      .select('conversations.id', 'conversations.intent')
      .groupBy('conversations.id');
    return result.map((row: { intent: string }) => row.intent);
  }

  async getTotalSessionCountByHotelId(
    hotel_id: string,
    start_date?: Date,
    end_date?: Date,
    session_type?: SessionType,
  ): Promise<number> {
    const result = await this.getIntentFilterQuery<Conversation>(
      this.db<Conversation>(this.tableName),
      hotel_id,
      start_date,
      end_date,
      session_type,
    )
      .countDistinct('sessions.id as count')
      .first();
    return Number(result.count || 0);
  }

  private getIntentFilterQuery<T extends {}>(
    query: Knex.QueryBuilder<T>,
    hotel_id: string,
    start_date?: Date,
    end_date?: Date,
    session_type?: SessionType,
  ): Knex.QueryBuilder<T> {
    session_type = session_type || SessionType.CALL;
    return query
      .innerJoin(
        'sessions',
        'conversations.conversation_session_id',
        'sessions.id',
      )
      .where('sessions.hotel_id', hotel_id)
      .modify((qb) => {
        if (start_date && end_date) {
          qb.andWhere('sessions.created_at', '>=', start_date.toISOString());
          qb.andWhere('sessions.created_at', '<=', end_date.toISOString());
        }
        qb.andWhere('sessions.session_type', '=', session_type);

        // Only apply ended_at checks for CALL sessions
        if (session_type === SessionType.CALL) {
          qb.whereNotNull('conversations.ended_at');
        }
        qb.whereNotNull('conversations.intent');
      });
  }
}
