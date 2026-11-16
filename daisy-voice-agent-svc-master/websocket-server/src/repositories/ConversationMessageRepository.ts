import { Knex } from 'knex';
import { TranscriptQueryMetadata } from '../dtos/ConversationMessage';
import { ConversationMessageRole } from '../dtos/enum/ConversationMessageRole';
import {
  ConversationMessage,
  DebugConversationMessage,
} from '../models/ConversationMessage';
import { SortOrder } from '../types/enums';
import { BaseRepository } from './BaseRepository';

export interface DebugQueryParams {
  phoneNumber?: string;
  hotelId?: string;
  limit?: number;
  sortOrder?: SortOrder;
  startTime?: Date;
  endTime?: Date;
}

export class ConversationMessageRepository extends BaseRepository {
  private tableName = 'conversation_messages';

  async insertMany(
    data: Omit<ConversationMessage, 'id' | 'created_at' | 'updated_at'>[],
    trx?: Knex.Transaction,
  ): Promise<ConversationMessage[]> {
    const dbOrTrx = trx || this.db;
    const queryBuilder = dbOrTrx(this.tableName)
      .insert(
        data.map((msg) => ({
          ...msg,
          tool_calls: msg.tool_calls
            ? JSON.stringify(msg.tool_calls)
            : undefined,
          tool_call_results: msg.tool_call_results
            ? JSON.stringify(msg.tool_call_results)
            : undefined,
        })),
      )
      .returning('*');

    try {
      const result = await queryBuilder;
      return result;
    } catch (error) {
      throw error;
    }
  }

  async create(
    data: Omit<ConversationMessage, 'id' | 'created_at' | 'updated_at'>,
    trx?: Knex.Transaction,
  ): Promise<ConversationMessage> {
    const dbOrTrx = trx || this.db;
    const queryBuilder = dbOrTrx(this.tableName)
      .insert({
        ...data,
        tool_calls: data.tool_calls
          ? JSON.stringify(data.tool_calls)
          : undefined,
        tool_call_results: data.tool_call_results
          ? JSON.stringify(data.tool_call_results)
          : undefined,
      })
      .returning('*');
    try {
      const [result] = await queryBuilder;
      return result;
    } catch (error) {
      throw error;
    }
  }

  async findById(id: string): Promise<ConversationMessage | null> {
    const result = await this.db(this.tableName).where({ id }).first();
    return result || null;
  }

  async findByConversationId(
    conversation_id: string,
  ): Promise<ConversationMessage[]> {
    return this.db(this.tableName)
      .where({ conversation_id })
      .orderBy('timestamp', 'asc');
  }

  async countByConversationIdAllRoles(
    conversation_id: string,
  ): Promise<number> {
    const result = await this.db(this.tableName)
      .where({ conversation_id })
      .count('id as count')
      .first();
    return Number(result?.count || 0);
  }

  /** Default: USER + AI. Pass roles to widen (e.g. channel history with SYSTEM/tool rows). */
  async countByConversationIdUserAndAi(
    conversation_id: string,
    roles: ConversationMessageRole[] = [
      ConversationMessageRole.USER,
      ConversationMessageRole.AI,
    ],
  ): Promise<number> {
    const result = await this.db(this.tableName)
      .where({ conversation_id })
      .whereIn('role', roles)
      .count('id as count')
      .first();
    return Number(result?.count || 0);
  }

  async findByConversationIdPaginatedAllRoles(
    conversation_id: string,
    offset: number,
    limit: number,
  ): Promise<ConversationMessage[]> {
    return this.db(this.tableName)
      .where({ conversation_id })
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(limit);
  }

  /** Default: USER + AI. Pass roles to widen (e.g. channel history with SYSTEM/tool rows). */
  async findByConversationIdPaginatedUserAndAi(
    conversation_id: string,
    offset: number,
    limit: number,
    roles: ConversationMessageRole[] = [
      ConversationMessageRole.USER,
      ConversationMessageRole.AI,
    ],
  ): Promise<ConversationMessage[]> {
    return this.db(this.tableName)
      .where({ conversation_id })
      .whereIn('role', roles)
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(limit);
  }

  private applyTimeWindowFilter(
    query: Knex.QueryBuilder,
    metadata: TranscriptQueryMetadata,
  ): void {
    // Filter by startTime only if provided
    if (metadata.startTime && !metadata.endTime) {
      query.where('timestamp', '>=', metadata.startTime);
    }
    // Filter by endTime only if provided
    else if (metadata.endTime && !metadata.startTime) {
      query.where('timestamp', '<=', metadata.endTime);
    }
    // Filter by both if both are provided
    else if (metadata.startTime && metadata.endTime) {
      query.whereBetween('timestamp', [metadata.startTime, metadata.endTime]);
    }
  }

  async findTranscriptsByConversationId(
    conversation_id: string,
    offset: number = 0,
    limit: number = 10,
    metadata?: TranscriptQueryMetadata,
  ): Promise<ConversationMessage[]> {
    const query = this.db(this.tableName)
      .where({ conversation_id })
      .whereIn('conversation_messages.role', [
        ConversationMessageRole.USER,
        ConversationMessageRole.AI,
      ]);

    // Apply time window filter if startTime or endTime is provided
    if (metadata?.startTime || metadata?.endTime) {
      this.applyTimeWindowFilter(query, metadata);
    }

    const result = await query
      .orderBy('timestamp', 'asc')
      .offset(offset)
      .limit(limit);

    return result;
  }

  async findTranscriptsByPhoneNumberWithLimitAndSort(
    phoneNumber: string,
    limit: number,
    sortOrder: SortOrder,
  ): Promise<ConversationMessage[]> {
    return this.db(this.tableName)
      .join(
        'conversations',
        'conversation_messages.conversation_id',
        'conversations.id',
      )
      .where('conversations.phone_number', phoneNumber)
      .whereIn('conversation_messages.role', [
        ConversationMessageRole.USER,
        ConversationMessageRole.AI,
      ])
      .select('conversation_messages.*')
      .orderBy('conversation_messages.timestamp', sortOrder)
      .limit(limit);
  }

  async findHistoryByPhoneNumber(
    phoneNumber: string,
    hotelId: string,
    limit: number,
    sortOrder: SortOrder,
  ): Promise<ConversationMessage[]> {
    return this.db(this.tableName)
      .join(
        'conversations',
        'conversation_messages.conversation_id',
        'conversations.id',
      )
      .where('conversations.phone_number', phoneNumber)
      .where('conversations.hotel_id', hotelId)
      .whereIn('conversation_messages.role', [
        ConversationMessageRole.USER,
        ConversationMessageRole.AI,
        ConversationMessageRole.TOOL_CALLS,
        ConversationMessageRole.TOOL_CALL_RESULT,
      ])
      .select('conversation_messages.*')
      .orderBy('conversation_messages.timestamp', sortOrder)
      .limit(limit);
  }

  async debugQueryConversations(
    params: DebugQueryParams,
  ): Promise<DebugConversationMessage[]> {
    const {
      phoneNumber,
      hotelId,
      limit = 100,
      sortOrder = SortOrder.DESC,
      startTime,
      endTime,
    } = params;

    let query = this.db(this.tableName).join(
      'conversations',
      'conversation_messages.conversation_id',
      'conversations.id',
    );

    if (phoneNumber) {
      query = query.where('conversations.phone_number', phoneNumber);
    }
    if (hotelId) {
      query = query.where('conversations.hotel_id', hotelId);
    }

    if (startTime || endTime) {
      this.applyTimeWindowFilter(query as Knex.QueryBuilder, {
        startTime,
        endTime,
      });
    }

    return query
      .select(
        'conversation_messages.*',
        'conversations.phone_number',
        'conversations.hotel_id',
      )
      .orderBy('conversation_messages.timestamp', sortOrder)
      .limit(limit);
  }

  async getTotalTranscriptCount(
    conversation_id: string,
    metadata?: TranscriptQueryMetadata,
  ): Promise<number> {
    const query = this.db(this.tableName)
      .where({ conversation_id })
      .whereIn('conversation_messages.role', [
        ConversationMessageRole.USER,
        ConversationMessageRole.AI,
      ]);

    // Apply time window filter if startTime or endTime is provided
    if (metadata?.startTime || metadata?.endTime) {
      this.applyTimeWindowFilter(query, metadata);
    }

    const result = await query.count('id as count').first();

    return Number(result?.count || 0);
  }

  async update(
    id: string,
    data: Partial<
      Omit<ConversationMessage, 'id' | 'created_at' | 'updated_at'>
    >,
  ): Promise<ConversationMessage | null> {
    const [result] = await this.db(this.tableName)
      .where({ id })
      .update(data)
      .returning('*');
    return result || null;
  }

  async delete(id: string): Promise<boolean> {
    const count = await this.db(this.tableName).where({ id }).delete();
    return count > 0;
  }
}
