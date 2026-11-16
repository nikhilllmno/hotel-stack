import { Knex } from 'knex';
import { PaymentStatus } from '../dtos/enum/PaymentStatus';
import { Payment } from '../models/Payment';
import { PaymentReservation } from '../models/PaymentReservation';
import { transformPaymentNumericFields } from '../utils/helper';
import { BaseRepository } from './BaseRepository';

export class PaymentReservationRepository extends BaseRepository {
  private tableName = 'payment_reservations';

  async create(
    data: Omit<PaymentReservation, 'id' | 'created_at' | 'updated_at'>,
    transaction?: Knex.Transaction,
  ): Promise<PaymentReservation> {
    const trxOrDb = transaction || this.db;
    const [result] = await trxOrDb(this.tableName).insert(data).returning('*');
    return result;
  }

  async createMany(
    data: Omit<PaymentReservation, 'id' | 'created_at' | 'updated_at'>[],
    transaction?: Knex.Transaction,
  ): Promise<PaymentReservation[]> {
    if (!data?.length) return [];

    const trxOrDb = transaction || this.db;
    const result = await trxOrDb(this.tableName).insert(data).returning('*');
    return result;
  }

  async findById(id: string): Promise<PaymentReservation | null> {
    if (!id) {
      return null;
    }
    const result = await this.db(this.tableName).where({ id }).first();
    return result || null;
  }

  async findByPaymentId(paymentId: string): Promise<PaymentReservation[]> {
    return this.db(this.tableName)
      .where({ payment_id: paymentId })
      .orderBy('created_at', 'desc');
  }

  async findByReservationId(
    reservationId: string,
  ): Promise<PaymentReservation[]> {
    return this.db(this.tableName)
      .where({ reservation_id: reservationId })
      .orderBy('created_at', 'desc');
  }

  async findByPaymentAndReservation(
    paymentId: string,
    reservationId: string,
  ): Promise<PaymentReservation | null> {
    const result = await this.db(this.tableName)
      .where({ payment_id: paymentId, reservation_id: reservationId })
      .first();
    return result || null;
  }

  async findByPaymentIds(paymentIds: string[]): Promise<PaymentReservation[]> {
    if (!paymentIds?.length) return [];

    return this.db(this.tableName)
      .whereIn('payment_id', paymentIds)
      .orderBy('created_at', 'desc');
  }

  async findByReservationIds(
    reservationIds: string[],
  ): Promise<PaymentReservation[]> {
    if (!reservationIds?.length) return [];

    return this.db(this.tableName)
      .whereIn('reservation_id', reservationIds)
      .orderBy('created_at', 'desc');
  }

  async findAll(): Promise<PaymentReservation[]> {
    return this.db(this.tableName).orderBy('created_at', 'desc');
  }

  async delete(id: string, transaction?: Knex.Transaction): Promise<boolean> {
    const trxOrDb = transaction || this.db;
    const count = await trxOrDb(this.tableName).where({ id }).delete();
    return count > 0;
  }

  async deleteByPaymentId(
    paymentId: string,
    transaction?: Knex.Transaction,
  ): Promise<number> {
    const trxOrDb = transaction || this.db;
    return await trxOrDb(this.tableName)
      .where({ payment_id: paymentId })
      .delete();
  }

  async deleteByReservationId(
    reservationId: string,
    transaction?: Knex.Transaction,
  ): Promise<number> {
    const trxOrDb = transaction || this.db;
    return await trxOrDb(this.tableName)
      .where({ reservation_id: reservationId })
      .delete();
  }

  async deleteByPaymentAndReservation(
    paymentId: string,
    reservationId: string,
    transaction?: Knex.Transaction,
  ): Promise<boolean> {
    const trxOrDb = transaction || this.db;
    const count = await trxOrDb(this.tableName)
      .where({ payment_id: paymentId, reservation_id: reservationId })
      .delete();
    return count > 0;
  }

  /**
   * Links a payment to multiple reservations
   */
  async linkPaymentToReservations(
    paymentId: string,
    reservationIds: string[],
    transaction?: Knex.Transaction,
  ): Promise<PaymentReservation[]> {
    const data = reservationIds.map((reservationId) => ({
      payment_id: paymentId,
      reservation_id: reservationId,
    }));

    return this.createMany(data, transaction);
  }

  /**
   * Links a reservation to multiple payments
   */
  async linkReservationToPayments(
    reservationId: string,
    paymentIds: string[],
    transaction?: Knex.Transaction,
  ): Promise<PaymentReservation[]> {
    const data = paymentIds.map((paymentId) => ({
      payment_id: paymentId,
      reservation_id: reservationId,
    }));

    return this.createMany(data, transaction);
  }

  /**
   * Gets all payment IDs for given reservation IDs
   */
  async getPaymentIdsByReservationIds(
    reservationIds: string[],
  ): Promise<string[]> {
    if (!reservationIds?.length) return [];

    const results = await this.db(this.tableName)
      .distinct('payment_id')
      .whereIn('reservation_id', reservationIds);

    return results.map((row) => row.payment_id);
  }

  /**
   * Gets all reservation IDs for given payment IDs
   */
  async getReservationIdsByPaymentIds(paymentIds: string[]): Promise<string[]> {
    if (!paymentIds?.length) return [];

    const results = await this.db(this.tableName)
      .distinct('reservation_id')
      .whereIn('payment_id', paymentIds);

    return results.map((row) => row.reservation_id);
  }

  /**
   * Returns the subset of reservation IDs that have at least one COMPLETED payment.
   */
  async findReservationIdsWithCompletedPayments(
    reservationIds: string[],
  ): Promise<string[]> {
    if (!reservationIds?.length) return [];

    const results = await this.db(this.tableName)
      .distinct(`${this.tableName}.reservation_id`)
      .join('payments', 'payments.id', `${this.tableName}.payment_id`)
      .whereIn(`${this.tableName}.reservation_id`, reservationIds)
      .where('payments.payment_status', PaymentStatus.COMPLETED);

    return results.map((row: { reservation_id: string }) => row.reservation_id);
  }

  /**
   * Checks if a payment-reservation relationship exists
   */
  async relationshipExists(
    paymentId: string,
    reservationId: string,
  ): Promise<boolean> {
    const result = await this.db(this.tableName)
      .where({ payment_id: paymentId, reservation_id: reservationId })
      .first();
    return !!result;
  }

  /**
   * Finds the most recent payment linked to any of the given reservation IDs.
   * Returns the full Payment record with aggregated reservation_ids, or null if none found.
   *
   * Uses a two-step approach (find payment ID, then fetch full row + sibling reservation IDs)
   * to avoid `table.*` in GROUP BY which is unsupported by some query engines (e.g. pg-mem).
   */
  async findPaymentByReservationIds(
    reservationIds: string[],
  ): Promise<(Payment & { reservation_ids: string[] }) | null> {
    if (!reservationIds?.length) return null;

    // Step 1: find the most recent payment ID linked to any of these reservations
    const row = await this.db(this.tableName)
      .select(`${this.tableName}.payment_id`)
      .join('payments', 'payments.id', `${this.tableName}.payment_id`)
      .whereIn(`${this.tableName}.reservation_id`, reservationIds)
      .orderBy('payments.created_at', 'desc')
      .first();

    if (!row) return null;

    // Step 2: fetch the full payment record
    const payment: Payment | undefined = await this.db('payments')
      .where({ id: row.payment_id })
      .first();

    if (!payment) return null;

    // Step 3: collect all reservation IDs linked to this payment
    const siblings = await this.db(this.tableName)
      .select('reservation_id')
      .where({ payment_id: payment.id });

    return {
      ...transformPaymentNumericFields(payment),
      reservation_ids: siblings.map(
        (s: { reservation_id: string }) => s.reservation_id,
      ),
    };
  }
}
