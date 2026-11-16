import { Knex } from 'knex';
import config from '../config';
import { BookingReview } from '../models/BookingReview';
import { generateReservationReviewId } from '../utils/helper';
import logger from '../utils/logger';
import { BaseRepository } from './BaseRepository';

// Postgres unique-violation error code
const PG_UNIQUE_VIOLATION = '23505';

export class BookingReviewRepository extends BaseRepository {
  private tableName = 'booking_reviews';

  async create(
    data: Omit<BookingReview, 'id' | 'created_at'>,
    transaction?: Knex.Transaction,
  ): Promise<BookingReview> {
    const trxOrDb = transaction || this.db;
    const [result] = await trxOrDb(this.tableName).insert(data).returning('*');
    return result;
  }

  /**
   * Generates a unique reservation_review_id and inserts a booking_reviews row.
   * Checks for existence before inserting to avoid poisoning the active transaction
   * on a unique-constraint violation (a poisoned transaction cannot recover in Postgres).
   * The catch block handles the residual race-condition window between check and insert.
   */
  async createWithUniqueReviewId(
    data: Omit<BookingReview, 'id' | 'created_at' | 'reservation_review_id'>,
    transaction?: Knex.Transaction,
  ): Promise<BookingReview> {
    const maxRetries = config.BOOKING_REVIEW_ID_MAX_RETRIES;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const reservationReviewId = generateReservationReviewId();
      const exists = await this.findByReservationReviewId(
        reservationReviewId,
        transaction,
      );
      if (exists) {
        logger.warn(
          `booking_reviews: reservation_review_id collision (${reservationReviewId}), retrying (attempt ${attempt}/${maxRetries})`,
        );
        continue;
      }
      try {
        return await this.create(
          { ...data, reservation_review_id: reservationReviewId },
          transaction,
        );
      } catch (error: any) {
        if (attempt < maxRetries) {
          logger.warn(
            `booking_reviews: An error occurred while creating the booking review ${reservationReviewId}, retrying (attempt ${attempt}/${maxRetries})`,
          );
          continue;
        }
        throw error;
      }
    }
    throw new Error(
      'Failed to generate a unique reservation_review_id after max retries',
    );
  }

  async findByReservationReviewId(
    reservationReviewId: string,
    transaction?: Knex.Transaction,
  ): Promise<BookingReview | null> {
    const trxOrDb = transaction || this.db;
    const result = await trxOrDb(this.tableName)
      .where({ reservation_review_id: reservationReviewId })
      .first();
    return result || null;
  }

  /**
   * bookingId: (e.g. BK12345). For multi-room bookings, this is the shared prefix — individual reservations are BK12345_1, BK12345_2, etc. For single-room bookings, this is the same as the booking ID.
   */
  async findByBookingId(
    bookingId: string,
    transaction?: Knex.Transaction,
  ): Promise<BookingReview | null> {
    const trxOrDb = transaction || this.db;
    const result = await trxOrDb(this.tableName)
      .where({ booking_id: bookingId })
      .first();
    return result || null;
  }
}
