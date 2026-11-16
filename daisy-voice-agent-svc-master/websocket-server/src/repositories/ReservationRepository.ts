import { Knex } from 'knex';
import { Address } from '../dtos/Address';
import { Customer } from '../dtos/Customer';
import {
  ReservationDashboardSummaryV1,
  ReservationDashboardSummaryV2,
} from '../dtos/dashboard/bookingSummary';
import { PaymentStatus } from '../dtos/enum/PaymentStatus';
import { ReservationPaymentStatus } from '../dtos/enum/ReservationPaymentStatus';
import { ReservationStatus } from '../dtos/enum/ReservationStatus';
import { SessionType } from '../dtos/enum/SessionType';
import { Hotel } from '../dtos/Hotel';
import { HotelConfiguration } from '../dtos/HotelConfiguration';
import { Payment } from '../dtos/Payment';
import { Quote } from '../dtos/Quote';
import { Reservation as ReservationDTO } from '../dtos/Reservation';
import { ChannelModel } from '../models/ChannelModel';
import { Discount } from '../models/Discount';
import { Reservation } from '../models/Reservation';
import { PaymentProvider } from '../types/enums';
import { roundCurrency } from '../utils/helper';
import { TEST_RESERVATION_LIMIT } from '../utils/testPhone';
import { BaseRepository } from './BaseRepository';
import { hydrateHotelConfigurationRow } from './HotelConfigurationRepository';

/** A room is free of PMS booking claims when unclaimed or its claim is older than `staleBefore`. */
function notClaimedForPmsBooking(staleBefore: Date) {
  return (q: Knex.QueryBuilder) =>
    q
      .whereNull('pms_booking_claimed_at')
      .orWhere('pms_booking_claimed_at', '<', staleBefore);
}

export class ReservationRepository extends BaseRepository {
  private tableName = 'reservations';

  async create(
    data: Omit<Reservation, 'id' | 'created_at' | 'updated_at'>,
    transaction?: Knex.Transaction,
  ): Promise<Reservation> {
    const trxOrDb = transaction || this.db;
    const [result] = await trxOrDb(this.tableName).insert(data).returning('*');
    return result;
  }

  async createMany(
    data: Omit<Reservation, 'id' | 'created_at' | 'updated_at'>[],
    transaction?: Knex.Transaction,
  ): Promise<Reservation[]> {
    if (!data?.length) return [];

    const trxOrDb = transaction || this.db;
    const result = await trxOrDb(this.tableName).insert(data).returning('*');

    return result;
  }

  async findById(id: string): Promise<Reservation | null> {
    const result = await this.db(this.tableName).where({ id }).first();
    return result || null;
  }

  async findByExternalPublicId(
    externalPublicId: string,
    hotelId?: string,
  ): Promise<Reservation | null> {
    const query = this.db(this.tableName).where({
      external_public_id: externalPublicId,
    });
    if (hotelId) {
      query.andWhere({ hotel_id: hotelId });
    }
    const result = await query.first();
    return result || null;
  }

  /**
   * Finds a reservation scoped to a hotel and PMS, preferring external_id match
   * then falling back to external_public_id (confirmation number).
   */
  async findByHotelPmsAndExternalIdentifiers(
    hotelId: string,
    pmsProvider: string,
    externalId: string,
    externalPublicId?: string,
  ): Promise<Reservation | null> {
    const baseQuery = { hotel_id: hotelId, pms_provider: pmsProvider };

    const byExternalId = await this.db(this.tableName)
      .where({ ...baseQuery, external_id: externalId })
      .first();
    if (byExternalId) {
      return byExternalId;
    }

    if (!externalPublicId?.trim()) {
      return null;
    }

    const byPublicId = await this.db(this.tableName)
      .where({ ...baseQuery, external_public_id: externalPublicId.trim() })
      .first();
    return byPublicId || null;
  }

  async findByExternalId(externalId: string): Promise<Reservation[]> {
    const byExternalId = await this.db(this.tableName).where({
      external_id: externalId,
    });

    return byExternalId;
  }

  async findManyByIds(ids: string[]): Promise<Reservation[]> {
    return this.db(this.tableName).whereIn('id', ids);
  }

  async findAll(): Promise<Reservation[]> {
    return this.db(this.tableName);
  }

  /**
   * Finds INACTIVE reservations older than cutoff, excluding no-payment reservations
   * (payment_status = NOT_APPLICABLE) which have their own cleanup path.
   * Rooms a card submission is booking right now are skipped, see claimForPmsBooking.
   */
  async findStaleReservations(
    cutoff: Date,
    claimStaleBefore: Date,
  ): Promise<Reservation[]> {
    return this.db(this.tableName)
      .where({ status: ReservationStatus.INACTIVE })
      .andWhere('created_at', '<=', cutoff.toISOString())
      .andWhere(function () {
        this.whereNull('payment_status').orWhereNot(
          'payment_status',
          ReservationPaymentStatus.NOT_APPLICABLE,
        );
      })
      .andWhere(notClaimedForPmsBooking(claimStaleBefore));
  }

  /**
   * Finds no-payment reservations (payment_status = NOT_APPLICABLE) that are
   * INACTIVE and older than cutoff. These are reservations where the guest
   * never submitted the review page.
   * Rooms a card submission is booking right now are skipped, see claimForPmsBooking.
   */
  async findStaleNoPaymentReservations(
    cutoff: Date,
    claimStaleBefore: Date,
  ): Promise<Reservation[]> {
    return this.db(this.tableName)
      .where({
        status: ReservationStatus.INACTIVE,
        payment_status: ReservationPaymentStatus.NOT_APPLICABLE,
      })
      .andWhere('created_at', '<=', cutoff.toISOString())
      .andWhere(notClaimedForPmsBooking(claimStaleBefore));
  }

  /**
   * Claims pending rooms for a PMS booking, all or none. A room is free when it
   * is still INACTIVE and unclaimed, or its claim is older than `staleBefore`,
   * which frees a room left claimed by a crashed request.
   * @returns the claim time, which releasePmsBookingClaim needs, or null when
   * another caller holds some of the rooms
   */
  async claimForPmsBooking(
    ids: string[],
    staleBefore: Date,
  ): Promise<Date | null> {
    if (!ids.length) return null;
    const claimedAt = new Date();
    const claimed: { id: string }[] = await this.db(this.tableName)
      .whereIn('id', ids)
      .andWhere({ status: ReservationStatus.INACTIVE })
      .andWhere(notClaimedForPmsBooking(staleBefore))
      .update({ pms_booking_claimed_at: claimedAt })
      .returning('id');
    if (claimed.length === ids.length) return claimedAt;
    // Another caller holds some of the rooms; give back the ones taken here.
    await this.releasePmsBookingClaim(
      claimed.map((r) => r.id),
      claimedAt,
    );
    return null;
  }

  /**
   * Moves this caller's claim forward so a long booking does not go stale.
   * @returns the new claim time, or null when another caller has taken over
   * any of the rooms
   */
  async renewPmsBookingClaim(
    ids: string[],
    claimedAt: Date,
  ): Promise<Date | null> {
    const renewedAt = new Date();
    const renewed = await this.db(this.tableName)
      .whereIn('id', ids)
      .andWhere({ pms_booking_claimed_at: claimedAt })
      .update({ pms_booking_claimed_at: renewedAt });
    return renewed === ids.length ? renewedAt : null;
  }

  /**
   * Releases only the rooms still holding this claim, so a caller whose claim
   * went stale cannot free rooms another caller has since claimed.
   */
  async releasePmsBookingClaim(ids: string[], claimedAt: Date): Promise<void> {
    if (!ids.length) return;
    await this.db(this.tableName)
      .whereIn('id', ids)
      .andWhere({ pms_booking_claimed_at: claimedAt })
      .update({ pms_booking_claimed_at: null });
  }

  async update(
    id: string,
    data: Partial<Omit<Reservation, 'id' | 'created_at' | 'updated_at'>>,
    transaction?: Knex.Transaction,
  ): Promise<Reservation | null> {
    const trxOrDb = transaction || this.db;
    const [result] = await trxOrDb(this.tableName)
      .where({ id })
      .update(data)
      .returning('*');
    return result || null;
  }

  async updateMany(
    ids: string[],
    data: Partial<Omit<Reservation, 'id' | 'created_at' | 'updated_at'>>,
    transaction?: Knex.Transaction,
  ): Promise<Reservation[] | null> {
    const trxOrDb = transaction || this.db;
    const result = await trxOrDb(this.tableName)
      .whereIn('id', ids)
      .update(data)
      .returning('*');
    return result || null;
  }

  async findReservationWithDetails(
    idOrBookingIdOrExternalIdOrExternalPublicId: string,
    hotelId: string,
  ): Promise<ReservationDTO | null> {
    const query = this.getSelectQueryForDetails();
    const db = this.db;

    query.where('reservations.hotel_id', hotelId);

    query.andWhere(function () {
      this.where(
        'reservations.booking_id',
        idOrBookingIdOrExternalIdOrExternalPublicId,
      )
        .orWhere(
          db.raw('reservations.id::VARCHAR = ?', [
            idOrBookingIdOrExternalIdOrExternalPublicId,
          ]),
        )
        .orWhere(
          'reservations.external_id',
          idOrBookingIdOrExternalIdOrExternalPublicId,
        )
        .orWhere(
          'reservations.external_public_id',
          idOrBookingIdOrExternalIdOrExternalPublicId,
        );
    });

    const reservations = await query;

    if (!reservations.length) {
      return null;
    }

    const grouped = this.groupAndConvertToDTOs(reservations);
    return grouped[0] || null;
  }

  async findManyReservationWithDetailsByIds(
    ids: string[],
    types?: SessionType[],
  ): Promise<ReservationDTO[] | null> {
    const query = this.getSelectQueryForDetails().whereIn(
      'reservations.id',
      ids,
    );

    if (types?.length) {
      query.whereIn('reservations.type', types);
    }

    const reservations = await query;

    if (!reservations.length) {
      return null;
    }
    return this.groupAndConvertToDTOs(reservations);
  }

  async findManyReservationsWithDetailsByPaymentId(
    paymentId: string,
  ): Promise<ReservationDTO[] | null> {
    const reservations = await this.getSelectQueryForDetails().where(
      'payment_reservations.payment_id',
      paymentId,
    );

    if (!reservations.length) {
      return null;
    }

    return this.groupAndConvertToDTOs(reservations);
  }

  /**
   * Retrieves future reservation records by phone number.
   * @param phoneNumber - The phone number the customer called from during the reservation
   * @returns List of matching future reservation records
   */
  async getReservationsByPhoneNumber(
    callerPhoneNumber: string,
    hotelId: string,
    lastDigitsPhoneNumber?: string,
  ): Promise<ReservationDTO[]> {
    const query = this.getSelectQueryForDetails();

    if (lastDigitsPhoneNumber?.trim()) {
      // Match phone numbers ending with the last digits
      query.where('reservations.hotel_id', hotelId).andWhere(function () {
        this.where(
          'customers.phone_number',
          'like',
          `%${lastDigitsPhoneNumber.trim()}`,
        ).orWhere(
          'reservations.phone_number',
          'like',
          `%${lastDigitsPhoneNumber.trim()}`,
        );
      });
    } else {
      // Exact match on full caller phone number
      query.where('reservations.hotel_id', hotelId).andWhere(function () {
        this.where('customers.phone_number', callerPhoneNumber.trim()).orWhere(
          'reservations.phone_number',
          callerPhoneNumber.trim(),
        );
      });
    }

    query.orderBy('reservations.check_in', 'desc');

    const reservations = await query;
    return this.groupAndConvertToDTOs(reservations);
  }

  /**
   * Exact (case-insensitive) match on last name and check-out date — no
   * fuzzy/similarity matching. Returns rows of every status (including
   * cancelled/no-show) so the caller can distinguish "no such booking" from a
   * booking that exists but isn't eligible. Used where a caller has already
   * supplied an unambiguous last name and does not want approximate matches.
   */
  async getReservationsByExactLastNameAndCheckout(
    hotelId: string,
    lastName: string,
    checkoutDate: string,
  ): Promise<ReservationDTO[]> {
    const query = this.getSelectQueryForDetails();

    query
      .where('reservations.hotel_id', hotelId)
      .andWhere('reservations.check_out', checkoutDate)
      .andWhereRaw('LOWER(customers.last_name) = LOWER(?)', [lastName.trim()]);

    const reservations = await query;
    return this.groupAndConvertToDTOs(reservations);
  }

  /**
   * Exact (case-insensitive) match on guest name — no fuzzy/similarity
   * matching. A multi-token name matches first+last in either order (e.g.
   * "Smith John" matches a guest named "John Smith"). A single-token name
   * matches either the first or last name, unless `singleTokenNamePart` is
   * given, in which case it's matched against only that field.
   */
  async getReservationsByExactGuestName(
    hotelId: string,
    guestName: string,
    singleTokenNamePart?: 'first' | 'last',
  ): Promise<ReservationDTO[]> {
    const normalizedName = guestName.toLowerCase().trim().replace(/\s+/g, ' ');
    const tokens = normalizedName.split(' ').filter(Boolean);

    if (tokens.length === 0) {
      return [];
    }

    const query = this.getSelectQueryForDetails().where(
      'reservations.hotel_id',
      hotelId,
    );

    if (tokens.length === 1) {
      const [token] = tokens;

      if (singleTokenNamePart === 'first') {
        query.andWhereRaw('LOWER(customers.first_name) = ?', [token]);
      } else if (singleTokenNamePart === 'last') {
        query.andWhereRaw('LOWER(customers.last_name) = ?', [token]);
      } else {
        query.andWhere(function () {
          this.whereRaw('LOWER(customers.first_name) = ?', [token]).orWhereRaw(
            'LOWER(customers.last_name) = ?',
            [token],
          );
        });
      }
    } else {
      const first = tokens[0];
      const last = tokens.slice(1).join(' ');

      query.andWhere(function () {
        this.where(function () {
          this.whereRaw('LOWER(customers.first_name) = ?', [first]).andWhereRaw(
            'LOWER(customers.last_name) = ?',
            [last],
          );
        }).orWhere(function () {
          this.whereRaw('LOWER(customers.first_name) = ?', [last]).andWhereRaw(
            'LOWER(customers.last_name) = ?',
            [first],
          );
        });
      });
    }

    query.orderBy('reservations.check_in', 'desc');

    const reservations = await query;
    return this.groupAndConvertToDTOs(reservations);
  }

  /**
   * Retrieves future reservation records by phone number.
   * @param phoneNumber - The phone number the customer called from during the reservation
   * @returns List of matching future reservation records
   */
  async getReservationsByLastDigitsPhoneNumber(
    lastDigitsPhoneNumber: string,
    hotelId: string,
  ): Promise<ReservationDTO[]> {
    const query = this.getSelectQueryForDetails();

    query.where('reservations.hotel_id', hotelId).andWhere(function () {
      this.where(
        'customers.phone_number',
        'like',
        `%${lastDigitsPhoneNumber.trim()}`,
      ).orWhere(
        'reservations.phone_number',
        'like',
        `%${lastDigitsPhoneNumber.trim()}`,
      );
    });

    const reservations = await query;
    return this.groupAndConvertToDTOs(reservations);
  }

  /**
   * Retrieves est reservations by phone number.
   * @param callerPhoneNumber - The phone number the customer called from during the reservation
   * @param assistantPhoneNumber - The phone number of the assistant
   * @returns List of matching test reservation records
   */
  async getTestReservationsByPhoneNumber(
    callerPhoneNumber: string,
    hotelId: string,
  ): Promise<ReservationDTO[]> {
    const reservationIdsSubquery = this.db('reservations')
      .select('reservations.id')
      .innerJoin('customers', 'reservations.customer_id', 'customers.id')
      .where('reservations.hotel_id', hotelId)
      .andWhere(function () {
        this.where('customers.phone_number', callerPhoneNumber.trim()).orWhere(
          'reservations.phone_number',
          callerPhoneNumber.trim(),
        );
      })
      .orderBy('reservations.check_in', 'desc')
      .limit(TEST_RESERVATION_LIMIT);

    const query = this.getSelectQueryForDetails().whereIn(
      'reservations.id',
      reservationIdsSubquery,
    );
    query.orderBy('reservations.check_in', 'desc');

    const reservations = await query;
    return this.groupAndConvertToDTOs(reservations).slice(
      0,
      TEST_RESERVATION_LIMIT,
    );
  }

  /**
   * Retrieves est reservations by last digits of phone number.
   * @param callerPhoneNumber - The phone number the customer called from during the reservation
   * @param assistantPhoneNumber - The phone number of the assistant
   * @returns List of matching test reservation records
   */
  async getTestReservationsByLastDigitsPhoneNumber(
    lastDigitsPhoneNumber: string,
    hotelId: string,
  ): Promise<ReservationDTO[]> {
    const reservationIdsSubquery = this.db('reservations')
      .select('reservations.id')
      .innerJoin('customers', 'reservations.customer_id', 'customers.id')
      .where('reservations.hotel_id', hotelId)
      .andWhere(function () {
        this.where(
          'customers.phone_number',
          'like',
          `%${lastDigitsPhoneNumber.trim()}`,
        ).orWhere(
          'reservations.phone_number',
          'like',
          `%${lastDigitsPhoneNumber.trim()}`,
        );
      })
      .orderBy('reservations.check_in', 'desc')
      .limit(TEST_RESERVATION_LIMIT);

    const query = this.getSelectQueryForDetails().whereIn(
      'reservations.id',
      reservationIdsSubquery,
    );
    query.orderBy('reservations.check_in', 'desc');

    const reservations = await query;
    return this.groupAndConvertToDTOs(reservations).slice(
      0,
      TEST_RESERVATION_LIMIT,
    );
  }

  public async getReservationDetailsBySessionId(
    session_id: string,
  ): Promise<ReservationDTO[] | null> {
    const reservation = await this.getSelectQueryForDetails()
      .where('reservations.session_id', session_id)
      .orderBy('reservations.check_in', 'desc');
    return this.groupAndConvertToDTOs(reservation);
  }

  public async getReservationsBySessionIds(sessionIds: string[]) {
    const reservation = await this.getSelectQueryForDetails().whereIn(
      'reservations.session_id',
      sessionIds,
    );
    return this.groupAndConvertToDTOs(reservation);
  }

  public async getReservationsForCheckInNotification(
    hotelId: string,
    checkInDate: string,
    statuses: ReservationStatus[],
  ): Promise<ReservationDTO[]> {
    const reservation = await this.getSelectQueryForDetails()
      .where('reservations.hotel_id', hotelId)
      .andWhere('reservations.check_in', checkInDate)
      .whereIn('reservations.status', statuses)
      .whereNot((qb) => {
        qb.where(
          'reservations.previous_status',
          ReservationStatus.INACTIVE,
        ).andWhere('reservations.status', ReservationStatus.CANCELLED);
      })
      .orderBy('check_in', 'desc');
    return this.groupAndConvertToDTOs(reservation);
  }

  protected getSelectQueryForDetails() {
    return this.db(this.tableName)
      .select(
        // Reservations
        'reservations.id as reservation_id',
        'reservations.business_id',
        'reservations.hotel_id',
        'reservations.booking_id',
        'reservations.status',
        'reservations.previous_status',
        'reservations.payment_status as reservation_payment_status',
        'reservations.check_in',
        'reservations.check_out',
        'reservations.room_id',
        'reservations.room_type',
        'reservations.num_adults',
        'reservations.num_children',
        'reservations.num_pets',
        'reservations.customer_id as reservation_customer_id',
        'reservations.phone_number as reservation_phone_number',
        'reservations.pms_provider as reservation_pms_provider',
        'reservations.status as reservation_status',
        'reservations.notes_from_partner',
        'reservations.customer_special_request',
        'reservations.session_id',
        'reservations.external_id',
        'reservations.external_public_id',
        'reservations.created_at',
        'reservations.updated_at',
        'reservations.type',
        'reservations.auto_charge',
        'reservations.onboarding_sms_sent',
        'reservations.rate_code',
        'reservations.source',
        // Customers
        'customers.id as customer_id',
        'customers.hotel_id as customer_hotel_id',
        'customers.first_name',
        'customers.last_name',
        'customers.phone_number as customer_phone_number',
        'customers.email',
        'customers.payment_provider_customer_id',
        'customers.signature as customer_signature',
        'customers.device_details as customer_device_details',
        'customers.card_metadata as customer_card_metadata',
        // Contact Address
        'address.id as address_id',
        'address.customer_id as address_customer_id',
        'address.state_or_province',
        'address.postal_code',
        'address.country',
        'address.address_first_line',
        'address.city',
        // Billing Address
        'billing_addr.id as billing_address_id',
        'billing_addr.customer_id as billing_address_customer_id',
        'billing_addr.state_or_province as billing_state_or_province',
        'billing_addr.postal_code as billing_postal_code',
        'billing_addr.country as billing_country',
        'billing_addr.address_first_line as billing_address_first_line',
        'billing_addr.city as billing_city',
        // Hotels
        'hotels.id as hotel_id',
        'hotels.name as hotel_name',
        'hotels.business_id as hotel_business_id',
        'hotels.pms_provider as hotel_pms_provider',
        'hotels.payment_provider as hotel_payment_provider',
        'hotels.telegram_check_in_group_id as hotel_telegram_check_in_group_id',
        'hotels.telegram_alerts_group_id as hotel_telegram_alerts_group_id',
        'hotels.timezone',
        'hotels.assistant_phone_number as hotel_assistant_phone_number',
        'hotels.country as hotel_country',
        'hotels.url as hotel_url',
        'hotels.sms_number as hotel_sms_number',
        'hotels.internal_phone_number as hotel_internal_phone_number',
        'hotels.address as hotel_address',
        'hotels.image_url as hotel_image_url',
        'hotels.currency as hotel_currency',
        'hotels.telegram_transcript_group_id as hotel_telegram_transcript_group_id',
        'hotels.notification_type as hotel_notification_type',
        // Hotel Configuration
        'hotel_configurations.id as hotel_configuration_id',
        'hotel_configurations.hotel_id as hotel_configuration_hotel_id',
        'hotel_configurations.last_daily_message as hotel_last_daily_message',
        'hotel_configurations.discount_settings as hotel_discount_settings',
        'hotel_configurations.cancellation_policy as hotel_cancellation_policy',
        'hotel_configurations.platform_fee_settings as hotel_platform_fee_settings',
        'hotel_configurations.sms_agent_enabled as hotel_sms_agent_enabled',
        'hotel_configurations.payment_configuration as hotel_payment_configuration',
        'hotel_configurations.same_day_booking_configuration as hotel_same_day_booking_configuration',
        'hotel_configurations.onboarding_sms_configuration as hotel_onboarding_sms_configuration',
        'hotel_configurations.terms_and_policy_config as hotel_terms_and_policy_config',
        'hotel_configurations.check_in_check_out_configuration as hotel_check_in_check_out_configuration',
        'hotel_configurations.negative_sentiment_followup_enabled as hotel_negative_sentiment_followup_enabled',
        'hotel_configurations.processing_fee_percentage as hotel_processing_fee_percentage',
        'hotel_configurations.addon_modification_allowlist as hotel_addon_modification_allowlist',
        'hotel_configurations.pet_policy_configuration as hotel_pet_policy_configuration',
        'hotel_configurations.payment_account_id as hotel_payment_account_id',
        'hotel_configurations.threeDS_config as hotel_threeDS_config',
        'hotel_configurations.twilio_configuration as hotel_twilio_configuration',
        'hotel_configurations.created_at as hotel_configuration_created_at',
        'hotel_configurations.updated_at as hotel_configuration_updated_at',
        'hotel_configurations.deleted_at as hotel_configuration_deleted_at',
        // Channels
        'channels.id as channel_id',
        'channels.hotel_id as channel_hotel_id',
        'channels.check_in_group_id as channel_check_in_group_id',
        'channels.alerts_group_id as channel_alerts_group_id',
        'channels.transcript_group_id as channel_transcript_group_id',
        'channels.type as channel_type',
        'channels.created_at as channel_created_at',
        'channels.updated_at as channel_updated_at',
        'channels.deleted_at as channel_deleted_at',
        // Payment Reservations Junction
        'payment_reservations.id as payment_reservation_junction_id',
        // Payments
        'payments.id as payment_id',
        'payments.hotel_id as payment_hotel_id',
        'payments.booking_confirmation_id',
        'payments.payment_status',
        'payments.payment_link',
        'payments.payment_link_id',
        'payments.amount_charged as payment_amount_charged',
        'payments.amount_refunded as payment_amount_refunded',
        'payments.metadata as payment_metadata',
        'payments.currency as payment_currency',
        'payments.updated_at as payment_updated_at',
        'payments.created_at as payment_created_at',
        'payments.notification_count as payment_notification_count',
        'payments.payment_provider as payment_provider',
        // Quotes
        'quotes.id as quote_id',
        'quotes.reservation_id as quote_reservation_id',
        'quotes.base_rate',
        'quotes.taxes',
        'quotes.fees',
        'quotes.amount_charged as quote_amount_charged',
        'quotes.quote_object',
        'quotes.platform_pricing',
        'quotes.created_at as quote_created_at',
        'quotes.updated_at as quote_updated_at',
        // Discount
        'discount.id as discount_id',
        'discount.phone_number as discount_phone_number',
        'discount.reservation_id as discount_reservation_id',
        'discount.value as discount_value',
        'discount.type as discount_type',
        'discount.hotel_id as discount_hotel_id',
        'discount.expiry_days as discount_expiry_days',
        'discount.note as discount_note',
        'discount.created_at as discount_created_at',
        'discount.updated_at as discount_updated_at',
      )
      .innerJoin('customers', 'reservations.customer_id', 'customers.id')
      .innerJoin('hotels', 'reservations.hotel_id', 'hotels.id')
      .leftJoin(
        this.db.raw(
          'hotel_configurations ON hotel_configurations.hotel_id = hotels.id AND hotel_configurations.deleted_at IS NULL',
        ),
      )
      .leftJoin(
        this.db.raw(
          'channels ON channels.hotel_id = hotels.id AND channels.deleted_at IS NULL',
        ),
      )
      .leftJoin(
        'payment_reservations',
        'reservations.id',
        'payment_reservations.reservation_id',
      )
      .leftJoin('payments', 'payment_reservations.payment_id', 'payments.id')
      .leftJoin('quotes', 'reservations.id', 'quotes.reservation_id')
      .leftJoin(
        this.db.raw(
          "address ON address.customer_id::UUID = reservations.customer_id::UUID AND address.address_type = 'contact'",
        ),
      )
      .leftJoin(
        this.db.raw(
          "address AS billing_addr ON billing_addr.customer_id::UUID = reservations.customer_id::UUID AND billing_addr.address_type = 'billing'",
        ),
      )
      .leftJoin('discount', 'reservations.id', 'discount.reservation_id');
  }

  /**
   * Groups query results by reservation and aggregates payments into arrays
   * @param results - Raw query results
   * @returns Array of ReservationDTOs with payments as arrays
   */
  private groupAndConvertToDTOs(results: any[]): ReservationDTO[] {
    const reservationMap = new Map<string, any>();

    // Group by reservation ID
    results.forEach((row) => {
      const reservationId = row.reservation_id;

      if (!reservationMap.has(reservationId)) {
        reservationMap.set(reservationId, {
          ...row,
          payments: [],
        });
      }

      // Add payment if it exists and isn't already added
      const reservation = reservationMap.get(reservationId);
      if (
        row.payment_id &&
        !reservation.payments.find((p: any) => p.id === row.payment_id)
      ) {
        reservation.payments.push({
          id: row.payment_id,
          payment_link: row.payment_link,
          payment_provider: row.payment_provider,
          payment_link_id: row.payment_link_id,
          amount_charged: row.payment_amount_charged,
          amount_refunded: row.payment_amount_refunded,
          currency: row.payment_currency,
          payment_status: row.payment_status,
          booking_confirmation_id: row.booking_confirmation_id,
          metadata: row.payment_metadata,
          notification_count: row.payment_notification_count,
          created_at: row.payment_created_at,
          updated_at: row.payment_updated_at,
        });
      }
    });

    // Convert to DTOs
    return Array.from(reservationMap.values()).map((reservation) =>
      this.convertToDTO(reservation),
    );
  }

  /**
   * Updates a reservation's status
   * @param id - Reservation ID
   * @param status - New status
   * @returns Updated reservation
   */
  async updateStatus(
    id: string,
    status: string,
    previous_status: string,
    transaction?: Knex.Transaction,
  ): Promise<Reservation | null> {
    const trxOrDb = transaction || this.db;
    const [result] = await trxOrDb(this.tableName)
      .where({ id })
      .update({ status, previous_status, updated_at: new Date() })
      .returning('*');
    return result || null;
  }

  /**
   * Updates reservation payment_status for reservations associated with payment IDs
   * @param reservationIds - Array of reservation IDs to update
   * @param payment_status - New payment status
   * @param transaction - Optional database transaction
   * @returns Number of updated reservations
   */
  async updatePaymentStatus(
    reservationIds: string[],
    payment_status: ReservationPaymentStatus,
    transaction?: Knex.Transaction,
  ): Promise<number> {
    if (!reservationIds?.length) {
      return 0;
    }
    const trxOrDb = transaction || this.db;
    const count = await trxOrDb(this.tableName)
      .whereIn('id', reservationIds)
      .update({ payment_status, updated_at: new Date() });
    return count;
  }

  private convertToDTO(reservation: any): ReservationDTO {
    const address: Address | null = reservation.address_id
      ? {
          id: reservation.address_id,
          customer_id: reservation.address_customer_id,
          state_or_province: reservation.state_or_province,
          postal_code: reservation.postal_code,
          ...(reservation.country && { country: reservation.country }),
          ...(reservation.address_first_line && {
            address_first_line: reservation.address_first_line,
          }),
          ...(reservation.city && { city: reservation.city }),
          created_at: reservation.address_created_at,
          updated_at: reservation.address_updated_at,
        }
      : null;

    const billing_address: Address | null = reservation.billing_address_id
      ? {
          id: reservation.billing_address_id,
          customer_id: reservation.billing_address_customer_id,
          state_or_province: reservation.billing_state_or_province,
          postal_code: reservation.billing_postal_code,
          ...(reservation.billing_country && {
            country: reservation.billing_country,
          }),
          ...(reservation.billing_address_first_line && {
            address_first_line: reservation.billing_address_first_line,
          }),
          ...(reservation.billing_city && { city: reservation.billing_city }),
        }
      : null;

    const customer: Customer = {
      id: reservation.customer_id,
      hotel_id: reservation.customer_hotel_id,
      first_name: reservation.first_name,
      last_name: reservation.last_name,
      email: reservation.email,
      phone_number: reservation.customer_phone_number,
      payment_provider_customer_id: reservation.payment_provider_customer_id,
      ...(reservation.customer_signature !== undefined && {
        signature: reservation.customer_signature,
      }),
      ...(reservation.customer_device_details !== undefined && {
        device_details: reservation.customer_device_details,
      }),
      ...(reservation.customer_card_metadata !== undefined && {
        card_metadata: reservation.customer_card_metadata,
      }),
      address,
      billing_address,
    };

    const hotel: Hotel = {
      id: reservation.hotel_id,
      name: reservation.hotel_name,
      business_id: reservation.hotel_business_id,
      pms_provider: reservation.hotel_pms_provider,
      payment_provider: reservation.hotel_payment_provider,
      telegram_check_in_group_id: reservation.hotel_telegram_check_in_group_id,
      telegram_alerts_group_id: reservation.hotel_telegram_alerts_group_id,
      timezone: reservation.timezone,
      created_at: reservation.hotel_created_at,
      updated_at: reservation.hotel_updated_at,
      assistant_phone_number: reservation.hotel_assistant_phone_number,
      country: reservation.hotel_country,
      sms_number: reservation.hotel_sms_number,
      internal_phone_number: reservation.hotel_internal_phone_number,
      address: reservation.hotel_address,
      image_url: reservation.hotel_image_url,
      currency: reservation.hotel_currency,
      url: reservation.hotel_url,
      telegram_transcript_group_id:
        reservation.hotel_telegram_transcript_group_id,
      notification_type: reservation.hotel_notification_type,
    };

    // Handle payments as an array (for many-to-many relationship)
    const payments: Payment[] = reservation.payments || [];

    const quote: Quote | null = reservation.quote_id
      ? {
          id: reservation.quote_id,
          reservation_id: reservation.quote_reservation_id,
          base_rate: reservation.base_rate,
          taxes: reservation.taxes,
          fees: reservation.fees,
          amount_charged: reservation.quote_amount_charged,
          total_amount: roundCurrency(
            (reservation.base_rate ?? 0) +
              (reservation.taxes ?? 0) +
              (reservation.fees ?? 0),
          ),
          quote_object: reservation.quote_object,
          platform_pricing: reservation.platform_pricing ?? null,
          created_at: reservation.quote_created_at,
          updated_at: reservation.quote_updated_at,
        }
      : null;

    const discount: Discount | null = reservation.discount_id
      ? {
          id: reservation.discount_id,
          reservation_id: reservation.discount_reservation_id,
          value: reservation.discount_value,
          type: reservation.discount_type,
          hotel_id: reservation.discount_hotel_id,
          phone_number: reservation.discount_phone_number,
          expiry_days: reservation.discount_expiry_days,
          note: reservation.discount_note,
          created_at: reservation.discount_created_at,
          updated_at: reservation.discount_updated_at,
        }
      : null;

    let hotel_configuration: HotelConfiguration | null =
      reservation.hotel_configuration_id
        ? {
            id: reservation.hotel_configuration_id,
            hotel_id: reservation.hotel_configuration_hotel_id,
            last_daily_message: reservation.hotel_last_daily_message,
            discount_settings: reservation.hotel_discount_settings,
            cancellation_policy: reservation.hotel_cancellation_policy,
            platform_fee_settings: reservation.hotel_platform_fee_settings,
            sms_agent_enabled: reservation.hotel_sms_agent_enabled,
            payment_configuration: reservation.hotel_payment_configuration,
            same_day_booking_configuration:
              reservation.hotel_same_day_booking_configuration,
            onboarding_sms_configuration:
              reservation.hotel_onboarding_sms_configuration,
            terms_and_policy_config: reservation.hotel_terms_and_policy_config,
            check_in_check_out_configuration:
              reservation.hotel_check_in_check_out_configuration,
            negative_sentiment_followup_enabled:
              reservation.hotel_negative_sentiment_followup_enabled,
            processing_fee_percentage:
              reservation.hotel_processing_fee_percentage ?? null,
            escalation_report_configuration:
              reservation.hotel_escalation_report_configuration,
            addon_modification_allowlist:
              reservation.hotel_addon_modification_allowlist ?? null,
            pet_policy_configuration:
              reservation.hotel_pet_policy_configuration ?? null,
            payment_account_id: reservation.hotel_payment_account_id,
            threeDS_config: reservation.hotel_threeDS_config,
            twilio_configuration: reservation.hotel_twilio_configuration,
            created_at: reservation.hotel_configuration_created_at,
            updated_at: reservation.hotel_configuration_updated_at,
            deleted_at: reservation.hotel_configuration_deleted_at,
          }
        : null;

    if (hotel_configuration) {
      hotel_configuration = hydrateHotelConfigurationRow(hotel_configuration);
    }

    const channel: ChannelModel | null = reservation.channel_id
      ? {
          id: reservation.channel_id,
          hotel_id: reservation.channel_hotel_id,
          check_in_group_id: reservation.channel_check_in_group_id,
          alerts_group_id: reservation.channel_alerts_group_id,
          transcript_group_id: reservation.channel_transcript_group_id,
          type: reservation.channel_type,
          created_at: reservation.channel_created_at,
          updated_at: reservation.channel_updated_at,
          deleted_at: reservation.channel_deleted_at,
        }
      : null;

    const reservationDetails: ReservationDTO = {
      id: reservation.reservation_id,
      booking_id: reservation.booking_id.toUpperCase(),
      external_id: reservation.external_id,
      external_public_id: reservation.external_public_id,
      session_id: reservation.session_id,
      check_in: reservation.check_in,
      check_out: reservation.check_out,
      previous_status: reservation.previous_status,
      status: reservation.status,
      payment_status: reservation.reservation_payment_status,
      phone_number: reservation.reservation_phone_number,
      pms_provider: reservation.reservation_pms_provider,
      created_at: reservation.created_at,
      updated_at: reservation.updated_at,
      room_type: reservation.room_type,
      num_pets: reservation.num_pets,
      type: reservation.type,
      auto_charge: reservation.auto_charge,
      onboarding_sms_sent: reservation.onboarding_sms_sent,
      rate_code: reservation.rate_code ?? null,
      customer,
      hotel,
      hotel_configuration,
      channel,
      payments,
      room_id: reservation.room_id,
      num_adults: reservation.num_adults,
      num_children: reservation.num_children,
      business_id: reservation.business_id,
      hotel_id: reservation.hotel_id,
      quote,
      customer_special_request: reservation.customer_special_request,
      notes_from_partner: reservation.notes_from_partner,
      discount,
      reservation_source: reservation.source,
    };

    return reservationDetails;
  }

  // Used in the new dashboard which provides all session types.
  async getReservationDashboardByHotelIdV2(
    hotel_id: string,
    start_date?: Date,
    end_date?: Date,
    session_types?: SessionType[],
    reservation_statuses: ReservationStatus[] = [
      ReservationStatus.ACTIVE,
      ReservationStatus.NO_SHOW,
    ],
  ): Promise<ReservationDashboardSummaryV2> {
    const types = session_types?.length ? session_types : [SessionType.CALL];
    const baseQuery = this.db<Reservation>(this.tableName)
      .innerJoin('hotels', 'hotels.id', 'reservations.hotel_id')
      .where('hotels.id', hotel_id)
      .modify((query) => {
        if (start_date && end_date) {
          query.andWhere(
            'reservations.created_at',
            '>=',
            start_date.toISOString(),
          );
          query.andWhere(
            'reservations.created_at',
            '<=',
            end_date.toISOString(),
          );
        }
        query.whereIn('reservations.type', types);
      });

    const reviewPendingReservations = await baseQuery
      .clone()
      .where(
        'reservations.payment_status',
        ReservationPaymentStatus.REVIEW_PENDING,
      )
      .select(
        this.db.raw(
          "COUNT(DISTINCT split_part(reservations.booking_id, '_', 1))::int AS total_review_pending_reservations",
        ),
      )
      .first();

    const includeCancelled = reservation_statuses.includes(
      ReservationStatus.CANCELLED,
    );
    const nonCancelledStatuses = reservation_statuses.filter(
      (s) => s !== ReservationStatus.CANCELLED,
    );

    const reservationResult = await baseQuery
      .clone()
      .innerJoin('quotes', 'quotes.reservation_id', 'reservations.id')
      .where((builder) => {
        if (nonCancelledStatuses.length) {
          builder.whereIn('reservations.status', nonCancelledStatuses);
        }
        if (includeCancelled) {
          builder.orWhere((sub) => {
            sub
              .where('reservations.status', ReservationStatus.CANCELLED)
              .where('reservations.previous_status', ReservationStatus.ACTIVE);
          });
        }
      })
      .select(
        this.db.raw(
          "COUNT(DISTINCT split_part(reservations.booking_id, '_', 1))::int AS total_reservations",
        ),
        this.db.raw(
          'SUM(COALESCE((quotes.base_rate + quotes.taxes + quotes.fees)::numeric(10,2), 0)) as total_amount',
        ),
      )
      .first();

    const paymentResult = await baseQuery
      .clone()
      .innerJoin(
        'payment_reservations',
        'payment_reservations.reservation_id',
        'reservations.id',
      )
      .innerJoin('payments', 'payments.id', 'payment_reservations.payment_id')
      .whereIn('payments.payment_status', [
        PaymentStatus.COMPLETED,
        PaymentStatus.REFUNDED,
        PaymentStatus.REFUND_FAILED,
      ])
      .select(
        this.db.raw(
          'SUM(COALESCE((payments.amount_charged::numeric - payments.amount_refunded::numeric)::numeric(10,2), 0)) as total_amount_collected',
        ),
      )
      .first();

    const result: ReservationDashboardSummaryV2 = {
      total_reservations: reservationResult?.total_reservations || 0,
      total_amount: reservationResult?.total_amount || 0,
      total_amount_collected: paymentResult?.total_amount_collected || 0,
      total_review_pending_reservations:
        reviewPendingReservations?.total_review_pending_reservations || 0,
    };

    return result;
  }

  // Used in the old dashboard which provides only call details.
  async getReservationDashboardByHotelIdV1(
    hotel_id: string,
    start_date?: Date,
    end_date?: Date,
    session_types?: SessionType[],
    reservation_statuses: ReservationStatus[] = [
      ReservationStatus.ACTIVE,
      ReservationStatus.NO_SHOW,
    ],
  ): Promise<ReservationDashboardSummaryV1> {
    const types = session_types?.length ? session_types : [SessionType.CALL];
    const includeCancelled = reservation_statuses.includes(
      ReservationStatus.CANCELLED,
    );
    const nonCancelledStatuses = reservation_statuses.filter(
      (s) => s !== ReservationStatus.CANCELLED,
    );
    const statusCondition = [
      nonCancelledStatuses.length
        ? `reservations.status IN (${nonCancelledStatuses.map((s) => `'${s}'`).join(', ')})`
        : null,
      includeCancelled
        ? `(reservations.status = '${ReservationStatus.CANCELLED}' AND reservations.previous_status = '${ReservationStatus.ACTIVE}')`
        : null,
    ]
      .filter(Boolean)
      .join(' OR ');

    const queryResult = await this.db<Reservation>(this.tableName)
      .select(
        this.db.raw(
          `COUNT(DISTINCT CASE WHEN ${statusCondition} THEN split_part(reservations.booking_id, '_', 1) END)::int AS total_reservations`,
        ),
        this.db.raw(
          `SUM(CASE WHEN ${statusCondition} THEN COALESCE((quotes.base_rate + quotes.taxes + quotes.fees)::numeric(10,2), 0) ELSE 0 END) as total_amount`,
        ),
      )
      .innerJoin('hotels', 'hotels.id', 'reservations.hotel_id')
      .innerJoin('quotes', 'quotes.reservation_id', 'reservations.id')
      .where('hotels.id', hotel_id)
      .modify((query) => {
        if (start_date && end_date) {
          query.andWhere(
            'reservations.created_at',
            '>=',
            start_date.toISOString(),
          );
          query.andWhere(
            'reservations.created_at',
            '<=',
            end_date.toISOString(),
          );
        }
        query.whereIn('reservations.type', types);
      })
      .first();

    const result: ReservationDashboardSummaryV1 = {
      total_reservations: queryResult?.total_reservations || 0,
      total_amount: queryResult?.total_amount || 0,
    };

    return result;
  }

  async linkSessionToReservations(reservationIds: string[], sessionId: string) {
    await this.db(this.tableName)
      .whereIn('id', reservationIds)
      .update({ session_id: sessionId });
  }

  async findReservationsByBookingIdForHotel(
    bookingId: string,
    hotelId: string,
  ): Promise<ReservationDTO[]> {
    const hasUnderscore = bookingId.includes('_');

    const query = this.getSelectQueryForDetails().where('hotels.id', hotelId);

    if (hasUnderscore) {
      // Exact match only for specific room in multi-room (e.g., BK20640_1)
      query.andWhere('reservations.booking_id', bookingId);
    } else {
      // Exact match OR prefix match for multi-room (e.g., BK20640)
      query.andWhere((builder) => {
        builder
          .where('reservations.booking_id', bookingId)
          .orWhere('reservations.booking_id', 'like', `${bookingId}_%`);
      });
    }

    const reservations = await query;

    if (!reservations || reservations.length === 0) {
      return [];
    }

    return this.groupAndConvertToDTOs(reservations);
  }

  async getUniqueParentBookingIds(
    hotel_id: string,
    offset: number,
    limit: number,
    search?: string,
    channels?: SessionType[],
    statuses?: ReservationStatus[],
    payment_statuses?: ReservationPaymentStatus[],
    start_date?: Date,
    end_date?: Date,
  ): Promise<string[]> {
    const query = this.db(this.tableName)
      .select(
        this.db.raw(`
          CASE 
            WHEN reservations.booking_id LIKE '%\\_%' 
            THEN SPLIT_PART(reservations.booking_id, '_', 1)
            ELSE reservations.booking_id 
          END as parent_booking_id
        `),
        this.db.raw('MAX(reservations.created_at) as latest_created_at'),
      )
      .innerJoin('hotels', 'reservations.hotel_id', 'hotels.id')
      .innerJoin('customers', 'reservations.customer_id', 'customers.id')
      .where('hotels.id', hotel_id);

    // Base filter: only ACTIVE, INACTIVE or (previous_status ACTIVE and current status CANCELLED) or (previous_status ACTIVE and current status NO_SHOW)
    query.where((builder) => {
      builder
        .where('reservations.status', ReservationStatus.ACTIVE)
        .orWhere('reservations.status', ReservationStatus.INACTIVE)
        .orWhere((subBuilder) => {
          subBuilder
            .where('reservations.previous_status', ReservationStatus.ACTIVE)
            .andWhere('reservations.status', ReservationStatus.CANCELLED);
        })
        .orWhere((subBuilder) => {
          subBuilder
            .where('reservations.previous_status', ReservationStatus.ACTIVE)
            .andWhere('reservations.status', ReservationStatus.NO_SHOW);
        });
    });

    // Apply search filter
    if (search) {
      const searchTerm = `%${search.toLowerCase()}%`;
      query.where((builder) => {
        builder
          .whereRaw('LOWER(customers.first_name) LIKE ?', [searchTerm])
          .orWhereRaw('LOWER(customers.last_name) LIKE ?', [searchTerm]);
      });
    }

    // Apply channel filter
    if (channels && channels.length > 0) {
      query.whereIn('reservations.type', channels);
    }

    // Apply status filter (additional filter on top of base filter)
    if (statuses && statuses.length > 0) {
      query.whereIn('reservations.status', statuses);
    }

    // Apply payment status filter
    if (payment_statuses && payment_statuses.length > 0) {
      query.whereIn('reservations.payment_status', payment_statuses);
    }

    // Apply date filter
    if (start_date && end_date) {
      query.andWhere('reservations.created_at', '>=', start_date.toISOString());
      query.andWhere('reservations.created_at', '<=', end_date.toISOString());
    }

    query.groupByRaw(`
      CASE 
        WHEN reservations.booking_id LIKE '%\\_%' 
        THEN SPLIT_PART(reservations.booking_id, '_', 1)
        ELSE reservations.booking_id 
      END
    `);

    query.orderBy('latest_created_at', 'desc');
    query.offset(offset).limit(limit);

    const results = await query;
    return results.map(
      (r: { parent_booking_id: string }) => r.parent_booking_id,
    );
  }

  async getReservationsByParentBookingIds(
    hotel_id: string,
    parentBookingIds: string[],
  ): Promise<ReservationDTO[]> {
    if (!parentBookingIds.length) {
      return [];
    }

    const query = this.getSelectQueryForDetails()
      .where('hotels.id', hotel_id)
      .where((builder) => {
        parentBookingIds.forEach((parentId, index) => {
          if (index === 0) {
            builder.where((subBuilder) => {
              subBuilder
                .where('reservations.booking_id', parentId)
                .orWhere('reservations.booking_id', 'like', `${parentId}_%`);
            });
          } else {
            builder.orWhere((subBuilder) => {
              subBuilder
                .where('reservations.booking_id', parentId)
                .orWhere('reservations.booking_id', 'like', `${parentId}_%`);
            });
          }
        });
      })
      .orderBy('reservations.created_at', 'desc');

    const reservations = await query;
    return this.groupAndConvertToDTOs(reservations);
  }

  async getUniqueParentBookingCount(
    hotel_id: string,
    search?: string,
    channels?: SessionType[],
    statuses?: ReservationStatus[],
    payment_statuses?: ReservationPaymentStatus[],
    start_date?: Date,
    end_date?: Date,
  ): Promise<number> {
    const query = this.db(this.tableName)
      .select(
        this.db.raw(`
          COUNT(DISTINCT 
            CASE 
              WHEN reservations.booking_id LIKE '%\\_%' 
              THEN SPLIT_PART(reservations.booking_id, '_', 1)
              ELSE reservations.booking_id 
            END
          ) as count
        `),
      )
      .innerJoin('hotels', 'reservations.hotel_id', 'hotels.id')
      .innerJoin('customers', 'reservations.customer_id', 'customers.id')
      .where('hotels.id', hotel_id);

    // Base filter: only ACTIVE, INACTIVE or (previous_status ACTIVE and current status CANCELLED) or (previous_status ACTIVE and current status NO_SHOW)
    query.where((builder) => {
      builder
        .where('reservations.status', ReservationStatus.ACTIVE)
        .orWhere('reservations.status', ReservationStatus.INACTIVE)
        .orWhere((subBuilder) => {
          subBuilder
            .where('reservations.previous_status', ReservationStatus.ACTIVE)
            .andWhere('reservations.status', ReservationStatus.CANCELLED);
        })
        .orWhere((subBuilder) => {
          subBuilder
            .where('reservations.previous_status', ReservationStatus.ACTIVE)
            .andWhere('reservations.status', ReservationStatus.NO_SHOW);
        });
    });

    // Apply search filter
    if (search) {
      const searchTerm = `%${search.toLowerCase()}%`;
      query.where((builder) => {
        builder
          .whereRaw('LOWER(customers.first_name) LIKE ?', [searchTerm])
          .orWhereRaw('LOWER(customers.last_name) LIKE ?', [searchTerm]);
      });
    }

    // Apply channel filter
    if (channels && channels.length > 0) {
      query.whereIn('reservations.type', channels);
    }

    // Apply status filter (additional filter on top of base filter)
    if (statuses && statuses.length > 0) {
      query.whereIn('reservations.status', statuses);
    }

    // Apply payment status filter
    if (payment_statuses && payment_statuses.length > 0) {
      query.whereIn('reservations.payment_status', payment_statuses);
    }

    // Apply date filter
    if (start_date && end_date) {
      query.andWhere('reservations.created_at', '>=', start_date.toISOString());
      query.andWhere('reservations.created_at', '<=', end_date.toISOString());
    }

    const result = (await query.first()) as { count: string } | undefined;
    return Number(result?.count || 0);
  }

  /**
   * Finds reservations that haven't had onboarding SMS sent yet
   * @param hotelId - The hotel ID
   * @param checkInDateInYYYYMMDD - Date in YYYY-MM-DD format
   * @param statuses - Array of reservation statuses to filter by
   * @returns List of reservations with customer details
   */
  async findReservationsForSendingOnboardingSMS(
    hotelId: string,
    checkInDateInYYYYMMDD: string,
    statuses: ReservationStatus[],
  ): Promise<ReservationDTO[]> {
    const reservations = await this.getSelectQueryForDetails()
      .where('reservations.hotel_id', hotelId)
      .andWhere('reservations.check_in', '=', checkInDateInYYYYMMDD)
      .andWhere('reservations.onboarding_sms_sent', '=', false)
      .andWhere('reservations.status', 'in', statuses);

    if (!reservations.length) {
      return [];
    }

    return this.groupAndConvertToDTOs(reservations);
  }

  /**
   * Finds reservations with auto-charge enabled and due for processing.
   * @param now - Current date/time
   * @param paymentProvider - Optional filter, used when a payment provider has
   *   its own dedicated scheduled job (e.g. Mews on a separate Lambda/cadence
   *   from Shift4) so each job only claims the rows it owns.
   * @returns List of reservations with auto-charge due
   */
  async findReservationsWithDueAutoCharge(
    now: Date,
    paymentProvider?: PaymentProvider,
  ): Promise<ReservationDTO[]> {
    const query = this.getSelectQueryForDetails()
      .whereRaw("reservations.auto_charge->>'is_enabled' = 'true'")
      .andWhereRaw(
        "(reservations.auto_charge->>'finalizes_at')::timestamp <= ?",
        [now.toISOString()],
      )
      .andWhere('reservations.status', '=', ReservationStatus.ACTIVE);

    if (paymentProvider) {
      query.andWhere('payments.payment_provider', '=', paymentProvider);
    }

    const reservations = await query;

    if (!reservations.length) {
      return [];
    }

    return this.groupAndConvertToDTOs(reservations);
  }
}

// Export singleton instance
const reservationRepository = new ReservationRepository();
export default reservationRepository;
