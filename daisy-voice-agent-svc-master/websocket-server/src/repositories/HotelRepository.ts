import { ChannelModel } from '../models/ChannelModel';
import { Hotel } from '../models/Hotel';
import { HotelConfiguration } from '../models/HotelConfiguration';
import { RoomTypesResponse } from '../stayntouch/types/RoomTypesResponse';
import { convertToPhoneNumber } from '../utils/helper';
import { BaseRepository } from './BaseRepository';
import { hydrateHotelConfigurationRow } from './HotelConfigurationRepository';

export class HotelRepository extends BaseRepository {
  private tableName = 'hotels';

  async create(
    data: Omit<Hotel, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<Hotel> {
    const now = new Date();
    const [result] = await this.db(this.tableName)
      .insert({
        ...data,
        created_at: now,
        updated_at: now,
      })
      .returning('*');
    return result;
  }

  private notDeleted() {
    return this.db(this.tableName).whereNull('deleted_at');
  }

  async findById(id: string): Promise<Hotel | null> {
    const result = await this.notDeleted().where({ id }).first();
    return result || null;
  }

  async findAll(): Promise<Hotel[]> {
    return this.notDeleted().orderBy('created_at', 'desc');
  }

  async findByIds(ids: string[]): Promise<Hotel[]> {
    if (ids.length === 0) return [];
    return this.notDeleted().whereIn('id', ids);
  }

  async findByTimezones(timezones: string[]): Promise<Hotel[]> {
    return this.notDeleted().whereIn('timezone', timezones);
  }

  async update(
    id: string,
    data: Partial<
      Omit<Hotel, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>
    >,
  ): Promise<Hotel | null> {
    const [result] = await this.notDeleted()
      .where({ id })
      .update({
        ...data,
        updated_at: new Date(),
      })
      .returning('*');
    return result || null;
  }

  async delete(id: string): Promise<boolean> {
    const count = await this.db(this.tableName)
      .where({ id })
      .whereNull('deleted_at')
      .update({ deleted_at: new Date() });
    return count > 0;
  }

  async findByName(name: string): Promise<Hotel | null> {
    const result = await this.notDeleted().where({ name }).first();
    return result || null;
  }

  async findByBusinessId(businessId: string): Promise<Hotel | null> {
    const result = await this.notDeleted()
      .where({ business_id: businessId })
      .first();
    return result || null;
  }

  async findByAssistantPhoneNumber(phoneNumber: string): Promise<Hotel | null> {
    const digits = (convertToPhoneNumber(phoneNumber) ?? phoneNumber).replace(
      /\D/g,
      '',
    );
    const result = await this.notDeleted()
      .whereRaw(
        "regexp_replace(assistant_phone_number, '[^0-9]', '', 'g') = ?",
        [digits],
      )
      .first();
    return result || null;
  }

  async findByBusinessIDorPhoneNumber(
    businessId?: string,
    phoneNumber?: string,
  ): Promise<Hotel | null> {
    const query = this.notDeleted();
    if (businessId) {
      query.where({ business_id: businessId });
    } else if (phoneNumber) {
      const digits = (convertToPhoneNumber(phoneNumber) ?? phoneNumber).replace(
        /\D/g,
        '',
      );
      query.whereRaw(
        "regexp_replace(assistant_phone_number, '[^0-9]', '', 'g') = ?",
        [digits],
      );
    } else {
      return null;
    }
    const result = await query.first();
    return result || null;
  }

  async findByTelegramAlertsChannelId(
    channelId: string,
  ): Promise<Hotel | null> {
    const result = await this.notDeleted()
      .where({ telegram_alerts_group_id: channelId })
      .first();
    return result || null;
  }

  async findByTelegramCheckInGroupId(groupId: string): Promise<Hotel | null> {
    const result = await this.notDeleted()
      .where({ telegram_check_in_group_id: groupId })
      .first();
    return result || null;
  }

  async findByTelegramTranscriptGroupId(
    groupId: string,
  ): Promise<Hotel | null> {
    const result = await this.notDeleted()
      .where({ telegram_transcript_group_id: groupId })
      .first();
    return result || null;
  }

  async findByIdWithConfigurationsAndChannels(id: string): Promise<{
    hotel: Hotel;
    configuration: HotelConfiguration | null;
    channel: ChannelModel | null;
  } | null> {
    // Fetch hotel (only non-deleted)
    const hotel = await this.notDeleted().where('id', id).first();

    if (!hotel) {
      return null;
    }

    // Fetch related configuration
    let configuration = await this.db('hotel_configurations')
      .where('hotel_id', id)
      .whereNull('deleted_at')
      .first();

    if (configuration) {
      configuration = hydrateHotelConfigurationRow(configuration);
    }

    // Fetch related channel
    const channel = await this.db('channels')
      .where('hotel_id', id)
      .whereNull('deleted_at')
      .first();

    return {
      hotel,
      configuration: configuration || null,
      channel: channel || null,
    };
  }

  async findByPmsProvider(pmsProvider: string): Promise<Hotel[]> {
    return this.db(this.tableName)
      .where({ pms_provider: pmsProvider })
      .whereNull('deleted_at');
  }

  async updateRoomTypes(
    hotelId: string,
    roomTypes: RoomTypesResponse,
  ): Promise<Hotel | null> {
    const [result] = await this.db(this.tableName)
      .where({ id: hotelId })
      .whereNull('deleted_at')
      .update({
        room_types: JSON.stringify(roomTypes),
        updated_at: new Date(),
      })
      .returning('*');
    return result || null;
  }
}
