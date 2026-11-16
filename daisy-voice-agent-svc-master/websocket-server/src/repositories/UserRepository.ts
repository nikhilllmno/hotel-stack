import { User } from '../models/User';
import { BaseRepository } from './BaseRepository';

// Type for User without password
type UserWithoutPassword = Omit<User, 'password'>;

export class UserRepository extends BaseRepository {
  private tableName = 'user';

  async create(
    data: Omit<User, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<UserWithoutPassword> {
    const [result] = await this.db(this.tableName)
      .insert(data)
      .returning([
        'id',
        'username',
        'role',
        'hotel_id',
        'created_at',
        'updated_at',
        'deleted_at',
      ]);
    return result;
  }

  async findById(id: string): Promise<UserWithoutPassword | null> {
    const result = await this.db(this.tableName)
      .select([
        'id',
        'username',
        'role',
        'hotel_id',
        'created_at',
        'updated_at',
        'deleted_at',
      ])
      .where({ id })
      .whereNull('deleted_at')
      .first();
    return result;
  }

  async findAll(): Promise<UserWithoutPassword[]> {
    return this.db(this.tableName)
      .select([
        'id',
        'username',
        'role',
        'hotel_id',
        'created_at',
        'updated_at',
        'deleted_at',
      ])
      .whereNull('deleted_at');
  }

  async findByUsername(username: string): Promise<UserWithoutPassword> {
    const result = await this.db(this.tableName)
      .select([
        'id',
        'username',
        'role',
        'hotel_id',
        'created_at',
        'updated_at',
        'deleted_at',
      ])
      .where({ username })
      .whereNull('deleted_at')
      .first();
    return result;
  }

  async getUserAndPasswordByUsername(username: string): Promise<User> {
    const result = await this.db(this.tableName)
      .where({ username })
      .whereNull('deleted_at')
      .first();
    return result;
  }

  async update(
    id: string,
    data: Partial<Omit<User, 'id' | 'created_at' | 'updated_at'>>,
  ): Promise<UserWithoutPassword | null> {
    const [result] = await this.db(this.tableName)
      .where({ id })
      .whereNull('deleted_at')
      .update(data)
      .returning([
        'id',
        'username',
        'role',
        'hotel_id',
        'created_at',
        'updated_at',
        'deleted_at',
      ]);
    return result || null;
  }

  async delete(id: string): Promise<boolean> {
    const [result] = await this.db(this.tableName)
      .where({ id })
      .whereNull('deleted_at')
      .update({ deleted_at: new Date() })
      .returning('id');

    return !!result;
  }

  async findByHotelId(hotel_Id: string): Promise<UserWithoutPassword[]> {
    return await this.db(this.tableName)
      .select([
        'id',
        'username',
        'role',
        'hotel_id',
        'created_at',
        'updated_at',
        'deleted_at',
      ])
      .where({ hotel_Id })
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc');
  }
}
