import { Knex } from 'knex';
import { PaymentStatus } from '../dtos/enum/PaymentStatus';
import { ReservationStatus } from '../dtos/enum/ReservationStatus';
import { Payment } from '../models/Payment';
import { transformPaymentNumericFields } from '../utils/helper';
import { BaseRepository } from './BaseRepository';

export class PaymentRepository extends BaseRepository {
  private tableName = 'payments';

  private paymentColumnsForGroupedSelect(): string[] {
    return [
      'payments.id',
      'payments.hotel_id',
      'payments.booking_confirmation_id',
      'payments.payment_status',
      'payments.payment_link',
      'payments.payment_link_id',
      'payments.amount_charged',
      'payments.currency',
      'payments.notification_count',
      'payments.payment_provider',
      'payments.amount_refunded',
      'payments.metadata',
      'payments.payment_link_disabled',
      'payments.created_at',
      'payments.updated_at',
    ];
  }

  private transformPayment(payment: any): Payment {
    return transformPaymentNumericFields(payment);
  }

  private transformPayments(payments: any[]): Payment[] {
    return payments.map((payment) => this.transformPayment(payment));
  }

  async create(
    data: Omit<
      Payment,
      'id' | 'created_at' | 'updated_at' | 'payment_link' | 'payment_link_id'
    >,
    transaction?: Knex.Transaction,
  ): Promise<Payment> {
    const trxOrDb = transaction || this.db;
    const [result] = await trxOrDb(this.tableName).insert(data).returning('*');
    return this.transformPayment(result);
  }

  async findById(
    id: string,
    transaction?: Knex.Transaction,
  ): Promise<Payment | null> {
    if (!id) {
      return null;
    }
    const trxOrDb = transaction || this.db;
    const result = await trxOrDb(this.tableName).where({ id }).first();
    return result ? this.transformPayment(result) : null;
  }

  async findByIds(
    ids: string[],
    statuses: PaymentStatus[] = [],
    transaction?: Knex.Transaction,
  ): Promise<Payment[]> {
    const trxOrDb = transaction || this.db;
    const query = trxOrDb(this.tableName)
      .whereIn('id', ids)
      .orderBy('created_at', 'desc');

    if (statuses.length > 0) {
      query.andWhere((builder) => {
        builder.whereIn('payment_status', statuses);
      });
    }

    const results = await query;
    return this.transformPayments(results);
  }

  async findAll(): Promise<Payment[]> {
    const results = await this.db(this.tableName);
    return this.transformPayments(results);
  }

  async update(
    id: string,
    data: Partial<Omit<Payment, 'id' | 'created_at' | 'updated_at'>>,
    transaction?: Knex.Transaction,
  ): Promise<Payment | null> {
    const trxOrDb = transaction || this.db;
    const [result] = await trxOrDb(this.tableName)
      .where({ id })
      .update(data)
      .returning('*');
    return result ? this.transformPayment(result) : null;
  }

  async updateNotificationCount(id: string): Promise<Payment | null> {
    const [result] = await this.db(this.tableName)
      .where({ id })
      .update({ notification_count: this.db.raw('notification_count + 1') })
      .returning('*');
    return result ? this.transformPayment(result) : null;
  }

  async updateMany(
    ids: string[],
    data: Partial<Omit<Payment, 'id' | 'created_at' | 'updated_at'>>,
    transaction?: Knex.Transaction,
  ): Promise<Payment[] | null> {
    const trxOrDb = transaction || this.db;
    const result = await trxOrDb(this.tableName)
      .whereIn('id', ids)
      .update(data)
      .returning('*');
    return result ? this.transformPayments(result) : null;
  }

  async delete(id: string): Promise<boolean> {
    const count = await this.db(this.tableName).where({ id }).delete();
    return count > 0;
  }

  async findByStripePaymentId(
    stripePaymentId: string,
  ): Promise<Payment | null> {
    const result = await this.db(this.tableName)
      .where({ stripe_payment_id: stripePaymentId })
      .first();
    return result ? this.transformPayment(result) : null;
  }

  async findByPaymentLinkId(
    paymentLinkId: string,
    transaction?: Knex.Transaction,
  ): Promise<Payment | null> {
    const trxOrDb = transaction || this.db;
    const result = await trxOrDb(this.tableName)
      .where({ payment_link_id: paymentLinkId })
      .first();
    return result ? this.transformPayment(result) : null;
  }

  async findByPaymentIdWithReservations(
    paymentId: string,
  ): Promise<(Payment & { reservation_ids: string[] }) | null> {
    const result = await this.db(this.tableName)
      .select(
        ...this.paymentColumnsForGroupedSelect(),
        this.db.raw('ARRAY_AGG(reservations.id) as reservation_ids'),
      )
      .innerJoin(
        'payment_reservations',
        'payment_reservations.payment_id',
        'payments.id',
      )
      .leftJoin(
        'reservations',
        'reservations.id',
        'payment_reservations.reservation_id',
      )
      .where({ 'payments.id': paymentId })
      .groupBy(...this.paymentColumnsForGroupedSelect())
      .first();
    return result
      ? {
          ...this.transformPayment(result),
          reservation_ids: result.reservation_ids,
        }
      : null;
  }

  async findByPaymentLinkIdWithReservations(
    paymentLinkId: string,
  ): Promise<(Payment & { reservation_ids: string[] }) | null> {
    const result = await this.db(this.tableName)
      .select(
        ...this.paymentColumnsForGroupedSelect(),
        this.db.raw('ARRAY_AGG(reservations.id) as reservation_ids'),
      )
      .innerJoin(
        'payment_reservations',
        'payment_reservations.payment_id',
        'payments.id',
      )
      .leftJoin(
        'reservations',
        'reservations.id',
        'payment_reservations.reservation_id',
      )
      .where({ 'payments.payment_link_id': paymentLinkId })
      .groupBy(...this.paymentColumnsForGroupedSelect())
      .first();
    return result
      ? {
          ...this.transformPayment(result),
          reservation_ids: result.reservation_ids,
        }
      : null;
  }

  async findByPaymentLinkWithReservations(
    paymentLink: string,
  ): Promise<(Payment & { reservation_ids: string[] }) | null> {
    const result = await this.db(this.tableName)
      .select(
        ...this.paymentColumnsForGroupedSelect(),
        this.db.raw('ARRAY_AGG(reservations.id) as reservation_ids'),
      )
      .innerJoin(
        'payment_reservations',
        'payment_reservations.payment_id',
        'payments.id',
      )
      .leftJoin(
        'reservations',
        'reservations.id',
        'payment_reservations.reservation_id',
      )
      .where({ 'payments.payment_link': paymentLink })
      .groupBy(...this.paymentColumnsForGroupedSelect())
      .first();
    return result
      ? {
          ...this.transformPayment(result),
          reservation_ids: result.reservation_ids,
        }
      : null;
  }

  async findByStatus(status: string): Promise<Payment[]> {
    const results = await this.db(this.tableName)
      .where({ status })
      .orderBy('created_at', 'desc');
    return this.transformPayments(results);
  }

  /**
   * Finds payments by an array of payment IDs, including all attached reservations and the hotel_id for each payment.
   * All reservations attached to a payment will have the same hotel_id.
   */
  async findPaymentsWithReservationsAndHotelId(
    paymentIds: string[],
    transaction?: Knex.Transaction,
  ): Promise<Array<Payment & { reservation_ids: string[]; hotel_id: string }>> {
    const trxOrDb = transaction || this.db;
    const results = await trxOrDb(this.tableName)
      .select(
        ...this.paymentColumnsForGroupedSelect(),
        trxOrDb.raw('ARRAY_AGG(reservations.id) as reservation_ids'),
        trxOrDb.raw('(ARRAY_AGG(reservations.hotel_id))[1] as hotel_id'),
      )
      .innerJoin(
        'payment_reservations',
        'payment_reservations.payment_id',
        'payments.id',
      )
      .leftJoin(
        'reservations',
        'reservations.id',
        'payment_reservations.reservation_id',
      )
      .whereIn('payments.id', paymentIds)
      .groupBy(...this.paymentColumnsForGroupedSelect());

    return results.map((result) => ({
      ...this.transformPayment(result),
      reservation_ids: result.reservation_ids,
      hotel_id: result.hotel_id,
    }));
  }

  /**
   * Finds payment IDs associated with the given reservation IDs.
   * Returns unique payment IDs.
   */
  async findPaymentIdsByReservationIds(
    reservationIds: string[],
  ): Promise<string[]> {
    if (!reservationIds.length) return [];

    const results = await this.db('payment_reservations')
      .select('payment_id')
      .whereIn('reservation_id', reservationIds)
      .distinct();

    return results.map((r) => r.payment_id);
  }

  /**
   * Updates payment for refund operation
   */
  async updatePaymentForRefund(
    paymentId: string,
    refundAmount: number,
    status: PaymentStatus,
    metadata?: any,
    transaction?: Knex.Transaction,
  ): Promise<Payment | null> {
    const trxOrDb = transaction || this.db;

    const updateData: any = {
      payment_status: status,
      amount_refunded: trxOrDb.raw('COALESCE(amount_refunded, 0) + ?', [
        refundAmount,
      ]),
      updated_at: new Date(),
    };

    if (metadata) {
      updateData.metadata = trxOrDb.raw(
        'COALESCE(metadata, ?::jsonb) || ?::jsonb',
        [{}, metadata],
      );
    }

    const [result] = await trxOrDb(this.tableName)
      .where({ id: paymentId })
      .update(updateData)
      .returning('*');
    return result ? this.transformPayment(result) : null;
  }

  /**
   * Finds pending payments whose payment_link_id starts with 'plink_' and that have
   * at least one associated reservation with INACTIVE status.
   */
  async findPendingPaymentsWithInactiveReservations(): Promise<
    Array<Payment & { reservation_ids: string[]; hotel_id: string }>
  > {
    const results = await this.db(this.tableName)
      .select(
        ...this.paymentColumnsForGroupedSelect(),
        this.db.raw('ARRAY_AGG(reservations.id) as reservation_ids'),
        this.db.raw('(ARRAY_AGG(reservations.hotel_id))[1] as hotel_id'),
      )
      .innerJoin(
        'payment_reservations',
        'payment_reservations.payment_id',
        'payments.id',
      )
      .innerJoin(
        'reservations',
        'reservations.id',
        'payment_reservations.reservation_id',
      )
      .where('payments.payment_status', PaymentStatus.PENDING)
      .whereNotNull('payments.payment_link')
      .andWhere('reservations.status', ReservationStatus.INACTIVE)
      .groupBy(...this.paymentColumnsForGroupedSelect());

    return results.map((result) => ({
      ...this.transformPayment(result),
      reservation_ids: result.reservation_ids,
      hotel_id: result.hotel_id,
    }));
  }

  /**
   * Finds completed payments that have at least one associated reservation
   * still stuck in INACTIVE status — i.e. the payment succeeded but PMS
   * reservation creation never completed.
   */
  async findCompletedPaymentsWithInactiveReservations(): Promise<
    Array<Payment & { reservation_ids: string[]; hotel_id: string }>
  > {
    const results = await this.db(this.tableName)
      .select(
        ...this.paymentColumnsForGroupedSelect(),
        this.db.raw('ARRAY_AGG(reservations.id) as reservation_ids'),
        this.db.raw('(ARRAY_AGG(reservations.hotel_id))[1] as hotel_id'),
      )
      .innerJoin(
        'payment_reservations',
        'payment_reservations.payment_id',
        'payments.id',
      )
      .innerJoin(
        'reservations',
        'reservations.id',
        'payment_reservations.reservation_id',
      )
      .where('payments.payment_status', PaymentStatus.COMPLETED)
      .andWhere('reservations.status', ReservationStatus.INACTIVE)
      .groupBy(...this.paymentColumnsForGroupedSelect());

    return results.map((result) => ({
      ...this.transformPayment(result),
      reservation_ids: result.reservation_ids,
      hotel_id: result.hotel_id,
    }));
  }

  /**
   * Finds a payment by its Stripe charge ID or payment intent ID
   */
  async findByStripeChargeOrPaymentIntent(
    chargeId?: string,
    paymentIntentId?: string,
  ): Promise<Payment | null> {
    if (!chargeId && !paymentIntentId) {
      return null;
    }

    let query = this.db(this.tableName);

    if (chargeId) {
      query = query.where('booking_confirmation_id', chargeId);
    } else if (paymentIntentId) {
      // If we need to search by payment intent ID, we might need to add that field to metadata or use another approach
      query = query.whereRaw("metadata->>'payment_intent_id' = ?", [
        paymentIntentId,
      ]);
    }

    const result = await query.first();
    return result ? this.transformPayment(result) : null;
  }

  /**
   * Finds a payment by its invoice ID (used for Shift4 payments)
   */
  async findByInvoiceId(invoiceId: string): Promise<Payment | null> {
    const result = await this.db(this.tableName)
      .where({ payment_link_id: invoiceId })
      .first();
    return result ? this.transformPayment(result) : null;
  }
}
