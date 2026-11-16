import { Knex } from 'knex';
import { Quote } from '../models/Quote';
import { BaseRepository } from './BaseRepository';

export class QuoteRepository extends BaseRepository {
  private tableName = 'quotes';

  async create(
    data: Omit<Quote, 'id' | 'created_at' | 'updated_at'>,
    transaction?: Knex.Transaction,
  ): Promise<Quote> {
    const trxOrDb = transaction || this.db;
    const [result] = await trxOrDb(this.tableName).insert(data).returning('*');
    return result;
  }

  async createMany(
    data: Omit<Quote, 'id' | 'created_at' | 'updated_at'>[],
    transaction?: Knex.Transaction,
  ): Promise<Quote[]> {
    if (!data?.length) return [];
    const trxOrDb = transaction || this.db;
    const result = await trxOrDb(this.tableName).insert(data).returning('*');
    return result;
  }

  async findById(id: string): Promise<Quote | null> {
    const result = await this.db(this.tableName).where({ id }).first();
    return result || null;
  }

  async findAll(): Promise<Quote[]> {
    return this.db(this.tableName);
  }

  async update(
    id: string,
    data: Partial<Omit<Quote, 'id' | 'created_at' | 'updated_at'>>,
  ): Promise<Quote | null> {
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

  async findByReservationId(reservationId: string): Promise<Quote | null> {
    const result = await this.db(this.tableName)
      .where({ reservation_id: reservationId })
      .orderBy('created_at', 'desc')
      .first();
    return result || null;
  }
}
