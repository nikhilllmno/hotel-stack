import { Escalation } from '../models/Escalations';
import { BaseRepository } from './BaseRepository';

export class EscalationRepository extends BaseRepository {
  private tableName = 'escalations';

  async create(
    data: Omit<
      Escalation,
      'id' | 'created_at' | 'updated_at' | 'reminder_count'
    >,
  ): Promise<Escalation> {
    const [result] = await this.db(this.tableName)
      .insert({
        ...data,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('*');
    return result;
  }

  async findById(id: string): Promise<Escalation | null> {
    const result = await this.db(this.tableName).where({ id }).first();
    return result || null;
  }

  async findByExternalMessageId(
    externalMessageId: string,
    hotelId: string,
  ): Promise<Escalation | null> {
    const result = await this.db(this.tableName)
      .where({ external_message_id: externalMessageId })
      .where({ hotel_id: hotelId })
      .first();
    return result || null;
  }

  async findByPhone(phone_number: string): Promise<Escalation | null> {
    const result = await this.db(this.tableName)
      .where({ phone_number })
      .first();
    return result || null;
  }

  async findEscalationBySessionId(
    session_id: string,
  ): Promise<Escalation[] | null> {
    const result = await this.db<Escalation>(this.tableName)
      .where({ session_id })
      .orderBy('created_at', 'desc');
    return result || null;
  }

  async getPaginatedEscalationsByHotelId(
    hotel_id: string,
    offset: number = 0,
    limit: number = 10,
    start_date?: Date,
    end_date?: Date,
  ): Promise<Escalation[]> {
    const result = this.db<Escalation>(this.tableName)
      .where('hotel_id', hotel_id)
      .modify((query) => {
        if (start_date && end_date) {
          query.andWhere('created_at', '>=', start_date.toISOString());
          query.andWhere('updated_at', '<=', end_date.toISOString());
        }
      })
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(limit);
    return result;
  }

  async getTotalEscalationCountByHotelId(
    hotel_id: string,
    start_date?: Date,
    end_date?: Date,
  ): Promise<number> {
    const result = await this.db<Escalation>(this.tableName)
      .where('hotel_id', hotel_id)
      .modify((query) => {
        if (start_date && end_date) {
          query.andWhere('created_at', '>=', start_date.toISOString());
          query.andWhere('updated_at', '<=', end_date.toISOString());
        }
      })
      .count('id as count')
      .first();

    const total_count = Number(result?.count || 0);
    return total_count;
  }

  async findOpenSince(hotelId: string, since: Date): Promise<Escalation[]> {
    return this.db<Escalation>(this.tableName)
      .where('hotel_id', hotelId)
      .where('status', '!=', 'DONE')
      .where('created_at', '>=', since.toISOString())
      .orderBy('created_at', 'asc');
  }

  async findNeedingReminder(
    hotelId: string,
    delayMinutes: number,
    windowMinutes: number,
    maxReminders: number,
  ): Promise<Escalation[]> {
    const now = new Date();
    return this.db<Escalation>(this.tableName)
      .where('hotel_id', hotelId)
      .where('status', '!=', 'DONE')
      .whereNotNull('external_message_id')
      .whereRaw('COALESCE(reminder_count, 0) < ?', [maxReminders])
      .whereRaw(
        `(created_at + (? * (COALESCE(reminder_count, 0) + 1)) * interval '1 minute')
         BETWEEN (?::timestamp - ? * interval '1 minute') AND ?::timestamp`,
        [delayMinutes, now.toISOString(), windowMinutes, now.toISOString()],
      )
      .orderBy('created_at', 'asc');
  }

  async findAll(): Promise<Escalation[]> {
    return this.db(this.tableName);
  }

  async update(
    id: string,
    data: Partial<Omit<Escalation, 'id' | 'created_at' | 'updated_at'>>,
  ): Promise<Escalation | null> {
    const [result] = await this.db(this.tableName)
      .where({ id })
      .update({
        ...data,
        updated_at: new Date(),
      })
      .returning('*');

    return result || null;
  }

  async delete(id: string): Promise<boolean> {
    const count = await this.db(this.tableName).where({ id }).delete();
    return count > 0;
  }
}
