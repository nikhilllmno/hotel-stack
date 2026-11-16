import { Knex } from 'knex';
import { ChannelModel } from '../models/ChannelModel';
import { BaseRepository } from './BaseRepository';

export class ChannelRepository extends BaseRepository {
  private tableName = 'channels';

  async findByHotelId(
    hotelId: string,
    trx?: Knex.Transaction,
  ): Promise<ChannelModel | null> {
    const dbInstance = trx || this.db;
    const result = await dbInstance(this.tableName)
      .where({ hotel_id: hotelId })
      .whereNull('deleted_at')
      .first();

    return result || null;
  }
}
