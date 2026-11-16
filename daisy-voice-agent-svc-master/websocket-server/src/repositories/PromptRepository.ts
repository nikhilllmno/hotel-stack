import { Prompt } from '../models/Prompt';
import { BaseRepository } from './BaseRepository';

export class PromptRepository extends BaseRepository {
  private tableName = 'prompts';

  async create(
    data: Omit<Prompt, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<Prompt> {
    const [result] = await this.db(this.tableName).insert(data).returning('*');
    return result;
  }

  async findById(id: string): Promise<Prompt | null> {
    const result = await this.db(this.tableName).where({ id }).first();
    return result || null;
  }

  async findAll(): Promise<Prompt[]> {
    return this.db(this.tableName);
  }

  async update(
    id: string,
    data: Partial<Omit<Prompt, 'id' | 'created_at' | 'updated_at'>>,
  ): Promise<Prompt | null> {
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

  async findByType(type: string): Promise<Prompt[]> {
    return this.db(this.tableName)
      .where({ type })
      .orderBy('created_at', 'desc');
  }

  async findLatestByType(type: string): Promise<Prompt | null> {
    const result = await this.db(this.tableName)
      .where({ type })
      .orderBy('created_at', 'desc')
      .first();
    return result || null;
  }
}
