import { Knex } from 'knex';
import { PmsProviderModel } from '../models/PmsProvider';
import { BaseRepository } from './BaseRepository';

export class PmsProviderRepository extends BaseRepository {
  private tableName = 'pms_providers';

  async create(
    data: Omit<PmsProviderModel, 'id'>,
    transaction?: Knex.Transaction,
  ): Promise<PmsProviderModel> {
    const trxOrDb = transaction || this.db;
    const [result] = await trxOrDb(this.tableName).insert(data).returning('*');
    return result;
  }

  async findById(id: string): Promise<PmsProviderModel | null> {
    const result = await this.db(this.tableName).where({ id }).first();
    return result || null;
  }

  async findByName(name: string): Promise<PmsProviderModel | null> {
    const result = await this.db(this.tableName).where({ name }).first();
    return result || null;
  }

  async findAll(): Promise<PmsProviderModel[]> {
    return this.db(this.tableName).select('*');
  }

  async findAllActive(): Promise<PmsProviderModel[]> {
    return this.db(this.tableName).where({ is_active: true }).select('*');
  }

  async update(
    id: string,
    data: Partial<PmsProviderModel>,
    transaction?: Knex.Transaction,
  ): Promise<PmsProviderModel | null> {
    const trxOrDb = transaction || this.db;
    const [result] = await trxOrDb(this.tableName)
      .where({ id })
      .update({
        ...data,
        updated_at: this.db.fn.now(),
      })
      .returning('*');
    return result || null;
  }

  async setActive(
    id: string,
    isActive: boolean,
    transaction?: Knex.Transaction,
  ): Promise<PmsProviderModel | null> {
    return this.update(id, { is_active: isActive }, transaction);
  }
}
