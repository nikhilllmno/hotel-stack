import { Knex } from 'knex';
import { CreateDiscountDto, Discount } from '../models/Discount';
import { BaseRepository } from './BaseRepository';

export class DiscountRepository extends BaseRepository {
  private tableName = 'discount';

  public async createDiscount(
    discountData: CreateDiscountDto,
  ): Promise<Discount> {
    const [discount] = await this.db(this.tableName)
      .insert(discountData)
      .returning('*');

    return discount;
  }

  public async getUnusedDiscountByPhoneNumberAndHotelId(
    phoneNumber: string,
    hotelId: string,
  ): Promise<Discount | null> {
    const discount = await this.db(this.tableName)
      .where({ phone_number: phoneNumber })
      .andWhere({ hotel_id: hotelId })
      .whereNull('reservation_id')
      .whereNull('deleted_at')
      .first();

    return discount || null;
  }

  // deleted_at filter should NOT be applied here. For instance, if a modification is being done,
  // the discount should be applicable for the modification as well. Modification can happen
  // after the discount expires.
  public async getDiscountByReservationId(
    reservationId: string,
  ): Promise<Discount | null> {
    const discount = await this.db(this.tableName)
      .where({ reservation_id: reservationId })
      .first();

    return discount || null;
  }

  public async updateDiscount(
    id: string,
    discountData: Partial<CreateDiscountDto>,
    transaction?: Knex.Transaction,
  ): Promise<Discount | null> {
    const trxOrDb = transaction || this.db;
    const [updatedDiscount] = await trxOrDb(this.tableName)
      .where({ id })
      .update({
        ...discountData,
        updated_at: trxOrDb.fn.now(),
      })
      .returning('*');

    return updatedDiscount || null;
  }

  public async linkDiscountToReservation(
    id: string,
    reservationId: string,
    transaction?: Knex.Transaction,
  ): Promise<Discount | null> {
    const trxOrDb = transaction || this.db;
    const [result] = await trxOrDb(this.tableName)
      .where({ id })
      .update({
        reservation_id: reservationId,
      })
      .returning('*');

    return result || null;
  }

  public async getAllActiveDiscounts(): Promise<Discount[]> {
    const discounts = await this.db(this.tableName)
      .select('id', 'expiry_days', 'created_at', 'hotel_id')
      .whereNull('deleted_at');

    return discounts;
  }

  public async markDiscountsAsDeleted(discountIds: string[]): Promise<number> {
    if (discountIds.length === 0) {
      return 0;
    }

    const deletedCount = await this.db(this.tableName)
      .whereIn('id', discountIds)
      .update({
        deleted_at: new Date(),
        updated_at: new Date(),
      });

    return deletedCount;
  }
}
