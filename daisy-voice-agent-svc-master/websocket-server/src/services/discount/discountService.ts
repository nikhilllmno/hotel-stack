import { Knex } from 'knex';
import { DuplicateDiscountError } from '../../errors/DuplicateDiscountError';
import { CreateDiscountDto, Discount } from '../../models/Discount';
import { DiscountRepository } from '../../repositories/discountRepository';
import logger from '../../utils/logger';

export class DiscountService {
  private static instance: DiscountService;
  private discountRepository: DiscountRepository;

  private constructor() {
    this.discountRepository = new DiscountRepository();
  }

  public static getInstance(): DiscountService {
    if (!DiscountService.instance) {
      DiscountService.instance = new DiscountService();
    }
    return DiscountService.instance;
  }

  /**
   * Create a new discount for a phone number
   * @param discountData Discount data to create
   * @returns Created discount
   */
  public async createDiscount(
    discountData: CreateDiscountDto,
  ): Promise<Discount> {
    try {
      // Check if discount already exists for this phone number
      const existingDiscount =
        await this.discountRepository.getUnusedDiscountByPhoneNumberAndHotelId(
          discountData.phone_number,
          discountData.hotel_id,
        );

      if (existingDiscount) {
        throw new DuplicateDiscountError(discountData.phone_number);
      }

      // Create new discount
      return await this.discountRepository.createDiscount(discountData);
    } catch (error) {
      logger.error(
        `createDiscount: Error creating discount for phone number ${discountData.phone_number}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Get discount details by phone number
   * @param phoneNumber Phone number to look up
   * @returns Discount details or null if not found
   */
  public async getUnusedDiscountByPhoneNumberAndHotelId(
    phoneNumber: string,
    hotelId: string,
  ): Promise<Discount | null> {
    try {
      return await this.discountRepository.getUnusedDiscountByPhoneNumberAndHotelId(
        phoneNumber,
        hotelId,
      );
    } catch (error) {
      logger.error(
        `getUnusedDiscountByPhoneNumberAndHotelId: Error getting discount by phone number and hotel ID: ${error}`,
      );
      throw error;
    }
  }

  public async getDiscountByReservationId(
    reservationId: string,
  ): Promise<Discount | null> {
    try {
      return await this.discountRepository.getDiscountByReservationId(
        reservationId,
      );
    } catch (error) {
      logger.error(`Error getting discount by reservation ID: ${error}`);
      throw error;
    }
  }

  public async linkDiscountToReservation(
    reservationId: string,
    discountId: string,
    transaction: Knex.Transaction,
  ): Promise<void> {
    try {
      await this.discountRepository.linkDiscountToReservation(
        reservationId,
        discountId,
        transaction,
      );
    } catch (error) {
      logger.error(`Error setting reservation ID for discount: ${error}`);
      throw error;
    }
  }

  /**
   * Get all active discounts for cleanup processing
   * @returns Array of active discount records
   */
  public async getAllActiveDiscounts(): Promise<Discount[]> {
    try {
      return await this.discountRepository.getAllActiveDiscounts();
    } catch (error) {
      logger.error(
        `getAllActiveDiscounts: Error getting all active discounts: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Mark multiple discounts as deleted
   * @param discountIds Array of discount IDs to mark as deleted
   * @returns Number of discounts marked as deleted
   */
  public async markDiscountsAsDeleted(discountIds: string[]): Promise<number> {
    try {
      return await this.discountRepository.markDiscountsAsDeleted(discountIds);
    } catch (error) {
      logger.error(
        `markDiscountsAsDeleted: Error marking discounts as deleted: ${error}`,
      );
      throw error;
    }
  }
}

// Export singleton instance
export const discountService = DiscountService.getInstance();
