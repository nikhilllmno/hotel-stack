/**
 * StayntouchReservationSyncService
 *
 * Persists Stayntouch webhook reservation events into the Daisy database.
 *
 * create_reservation: sessions -> customers -> reservations -> payments -> payment_reservations
 * edit_reservation: updates customer, reservation, and linked payments in one transaction
 *
 * If anything fails, the transaction is rolled back and the original webhook
 * event is logged in full for debugging.
 */

import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Knex } from 'knex';
import config from '../../config';
import db from '../../database/connection';
import { mapStayntouchSourceCodeToReservationSource } from '../../stayntouch/utils/helper';
import { formatPhoneNumber, generateBookingId } from '../../utils/helper';
import logger from '../../utils/logger';

import customerServiceInstance, {
  CustomerService,
} from '../customer/customerService';
import paymentServiceInstance, {
  PaymentService,
} from '../payment/paymentService';
import roomReservationServiceInstance, {
  RoomReservationService,
} from '../roomReservation/roomReservationService';
import sessionServiceInstance, {
  SessionService,
} from '../session/SessionService';

import { Currency } from '../../dtos/enum/Currency';
import { PaymentStatus } from '../../dtos/enum/PaymentStatus';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { SessionType } from '../../dtos/enum/SessionType';
import { StayntouchChargeCode } from '../../dtos/enum/StayntouchChargeCode';
import { StatusUpdateType } from '../../models/request/StatusUpdate';
import { Country, PaymentProvider, PmsProvider } from '../../types/enums';

import { Address as AddressDTO } from '../../dtos/Address';
import { Customer as CustomerDTO } from '../../dtos/Customer';
import { Hotel } from '../../models/Hotel';
import { Payment } from '../../models/Payment';
import { Reservation } from '../../models/Reservation';
import { Session } from '../../models/Session';

import {
  GetReservationBillTransactionResponse,
  GetReservationGuestResponse,
  GetReservationResponse,
} from '../../stayntouch/types/GetReservationResponse';
import { RoomTypeDetails } from '../../stayntouch/types/RoomTypesResponse';
import { StayntouchEvent } from '../../types/stayntouch.types';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Placeholder phone number used when the StayNTouch payload does not contain
 * a usable guest phone number. Must be a number that never resolves to a real
 * caller so downstream lookups treat it as "no phone available".
 */
const DUMMY_PHONE_NUMBER = '+10000000000';

const DEFAULT_CURRENCY = 'unavailable';

export class StayntouchReservationSyncService {
  constructor(
    private readonly sessionService: SessionService = sessionServiceInstance,
    private readonly customerService: CustomerService = customerServiceInstance,
    private readonly roomReservationService: RoomReservationService = roomReservationServiceInstance,
    private readonly paymentService: PaymentService = paymentServiceInstance,
  ) {}

  /**
   * Locates an existing Daisy reservation for a StayNTouch PMS record.
   */
  async findLocalReservation(
    hotel: Hotel,
    reservation: GetReservationResponse,
  ): Promise<Reservation | null> {
    return this.roomReservationService.findReservationByHotelPmsAndExternalIdentifiers(
      hotel.id,
      PmsProvider.STAYNTOUCH,
      String(reservation.id),
      reservation.confirmation_number,
    );
  }

  /**
   * Inserts the StayNTouch reservation into the Daisy database in a single
   * transaction. Re-throws any error after logging the original event so the
   * webhook layer can return a structured error response.
   */
  async syncCreateReservation(
    reservation: GetReservationResponse,
    hotel: Hotel,
    event: StayntouchEvent,
  ): Promise<{
    sessionId: string;
    customerId: string;
    reservationId: string;
    paymentId: string;
  }> {
    logger.info(
      'StayntouchReservationSyncService: Starting create_reservation sync',
      {
        externalReservationId: reservation.id,
        confirmationNumber: reservation.confirmation_number,
        stayntouchHotelId: reservation.hotel_id,
        hotelId: hotel.id,
        guestCount: reservation.guests?.length ?? 0,
        billCount: reservation.bills?.length ?? 0,
        stayDateCount: reservation.stay_dates?.length ?? 0,
      },
    );

    const trx = await db.transaction();
    try {
      logger.info(
        'StayntouchReservationSyncService: Database transaction started',
        {
          externalReservationId: reservation.id,
          confirmationNumber: reservation.confirmation_number,
          hotelId: hotel.id,
        },
      );

      const session = await this.insertSession(reservation, hotel, trx);
      logger.info('StayntouchReservationSyncService: Session inserted', {
        externalReservationId: reservation.id,
        confirmationNumber: reservation.confirmation_number,
        hotelId: hotel.id,
        sessionId: session.id,
      });

      const customer = await this.insertCustomer(reservation, hotel, trx);
      if (!customer.id) {
        throw new Error(
          'StayntouchReservationSyncService: Customer creation did not return an id',
        );
      }

      logger.info('StayntouchReservationSyncService: Customer inserted', {
        externalReservationId: reservation.id,
        confirmationNumber: reservation.confirmation_number,
        hotelId: hotel.id,
        customerId: customer.id,
      });

      const reservationRow = await this.insertReservation(
        reservation,
        hotel,
        customer.id,
        session.id,
        trx,
      );
      logger.info('StayntouchReservationSyncService: Reservation inserted', {
        externalReservationId: reservation.id,
        confirmationNumber: reservation.confirmation_number,
        hotelId: hotel.id,
        reservationId: reservationRow.id,
        bookingId: reservationRow.booking_id,
      });

      // TODO: Uncomment this when we have a proper way to insert payments for payment transactions
      // const payments = await this.insertPaymentsForPaymentTransactions(
      //   reservation,
      //   hotel,
      //   reservationRow.id,
      //   trx,
      // );
      const payments: Payment[] = [];

      logger.info(
        'StayntouchReservationSyncService: Committing create_reservation transaction',
        {
          externalReservationId: reservation.id,
          confirmationNumber: reservation.confirmation_number,
          hotelId: hotel.id,
        },
      );
      await trx.commit();

      logger.info(
        `StayntouchReservationSyncService: Successfully synced reservation external_id=${reservation.id} confirmation=${reservation.confirmation_number} hotel_id=${hotel.id}`,
        {
          externalReservationId: reservation.id,
          confirmationNumber: reservation.confirmation_number,
          hotelId: hotel.id,
          sessionId: session.id,
          customerId: customer.id,
          reservationId: reservationRow.id,
          paymentId: payments[0]?.id ?? '',
          paymentCount: payments.length,
        },
      );

      return {
        sessionId: session.id,
        customerId: customer.id,
        reservationId: reservationRow.id,
        paymentId: payments[0]?.id ?? '',
      };
    } catch (error) {
      await trx.rollback().catch((rollbackErr) => {
        logger.error(
          'StayntouchReservationSyncService: Transaction rollback failed',
          { rollbackErr },
        );
      });
      logger.error(
        `StayntouchReservationSyncService: Failed to sync create_reservation. Raw event=${JSON.stringify(event)}`,
        {
          error,
          externalReservationId: reservation.id,
          confirmationNumber: reservation.confirmation_number,
          hotelId: hotel.id,
        },
      );
      throw error;
    }
  }

  /**
   * Updates an existing Daisy reservation from a StayNTouch edit_reservation webhook.
   */
  async syncEditReservation(
    reservation: GetReservationResponse,
    hotel: Hotel,
    localReservation: Reservation,
    event: StayntouchEvent,
  ): Promise<{
    reservationId: string;
    customerId: string;
  }> {
    logger.info(
      'StayntouchReservationSyncService: Starting edit_reservation sync',
      {
        externalReservationId: reservation.id,
        confirmationNumber: reservation.confirmation_number,
        hotelId: hotel.id,
        localReservationId: localReservation.id,
        guestCount: reservation.guests?.length ?? 0,
        billCount: reservation.bills?.length ?? 0,
        stayDateCount: reservation.stay_dates?.length ?? 0,
      },
    );

    const trx = await db.transaction();
    try {
      if (localReservation.customer_id) {
        await this.updateCustomerFromReservation(
          reservation,
          hotel,
          localReservation.customer_id,
          trx,
        );
      }

      const updatedReservation = await this.updateReservationFromPms(
        reservation,
        hotel,
        localReservation,
        trx,
      );

      await trx.commit();

      logger.info(
        `StayntouchReservationSyncService: Successfully synced edit_reservation external_id=${reservation.id} confirmation=${reservation.confirmation_number}`,
        {
          externalReservationId: reservation.id,
          confirmationNumber: reservation.confirmation_number,
          hotelId: hotel.id,
          reservationId: updatedReservation.id,
          customerId: localReservation.customer_id,
        },
      );

      return {
        reservationId: updatedReservation.id,
        customerId: localReservation.customer_id,
      };
    } catch (error) {
      await trx.rollback().catch((rollbackErr) => {
        logger.error(
          'StayntouchReservationSyncService: Transaction rollback failed',
          { rollbackErr },
        );
      });
      logger.error(
        `StayntouchReservationSyncService: Failed to sync edit_reservation. Raw event=${JSON.stringify(event)}`,
        {
          error,
          externalReservationId: reservation.id,
          confirmationNumber: reservation.confirmation_number,
          hotelId: hotel.id,
          localReservationId: localReservation.id,
        },
      );
      throw error;
    }
  }

  private async updateCustomerFromReservation(
    reservation: GetReservationResponse,
    hotel: Hotel,
    customerId: string,
    trx: Knex.Transaction,
  ): Promise<void> {
    const primaryGuest = this.resolvePrimaryGuest(reservation.guests);
    if (!primaryGuest) {
      logger.info(
        'StayntouchReservationSyncService: Skipping customer update — no guests',
        {
          externalReservationId: reservation.id,
          customerId,
        },
      );
      return;
    }

    const customerPatch: Partial<CustomerDTO> = {};

    const firstName = primaryGuest.first_name?.trim();
    if (firstName) {
      customerPatch.first_name = firstName;
    }

    const lastName = primaryGuest.last_name?.trim();
    if (lastName) {
      customerPatch.last_name = lastName;
    }

    const email = primaryGuest.email?.trim();
    if (email) {
      customerPatch.email = email;
    }

    const guestPhone = this.formatGuestPhone(primaryGuest, hotel);
    if (guestPhone) {
      customerPatch.phone_number = guestPhone;
    }

    const address = this.mapGuestAddress(primaryGuest.address);
    if (address) {
      customerPatch.address = address;
    }

    const billingAddress = this.mapGuestAddress(primaryGuest.billing_address);
    if (billingAddress) {
      customerPatch.billing_address = billingAddress;
    }

    if (Object.keys(customerPatch).length === 0) {
      logger.info(
        'StayntouchReservationSyncService: Skipping customer update — no mappable fields',
        {
          externalReservationId: reservation.id,
          customerId,
        },
      );
      return;
    }

    await this.customerService.updateCustomer(customerId, customerPatch, trx);
    logger.info('StayntouchReservationSyncService: Customer updated', {
      externalReservationId: reservation.id,
      customerId,
      updatedFields: Object.keys(customerPatch),
    });
  }

  private async updateReservationFromPms(
    reservation: GetReservationResponse,
    hotel: Hotel,
    localReservation: Reservation,
    trx: Knex.Transaction,
  ): Promise<Reservation> {
    const firstStayDate = reservation.stay_dates?.[0];
    const roomTypeId = firstStayDate?.room_type_id;
    const roomTypeDetails = this.findRoomTypeDetails(hotel, roomTypeId);
    const newStatus = this.mapReservationStatus(reservation.status);
    const primaryGuest = this.resolvePrimaryGuest(reservation.guests);
    const guestPhone = this.formatGuestPhone(primaryGuest, hotel);
    const customerSpecialRequest = this.extractFirstNoteText(reservation);

    const reservationPatch: Partial<Reservation> = {
      business_id: String(reservation.hotel_id),
      check_in: this.parseDateOnly(reservation.arrival_date, hotel.timezone),
      check_out: this.parseDateOnly(reservation.departure_date, hotel.timezone),
      status: newStatus,
      previous_status: localReservation.status,
      external_id: String(reservation.id),
      external_public_id: reservation.confirmation_number,
      updated_at: this.parseDate(reservation.updated_time) ?? new Date(),
    };

    if (roomTypeId != null) {
      reservationPatch.room_id = roomTypeId;
    }
    if (firstStayDate?.adults != null) {
      reservationPatch.num_adults = firstStayDate.adults;
    }
    if (firstStayDate?.children != null) {
      reservationPatch.num_children = firstStayDate.children;
    }
    if (guestPhone) {
      reservationPatch.phone_number = guestPhone;
    }
    if (roomTypeDetails?.name) {
      reservationPatch.room_type = roomTypeDetails.name;
    } else if (roomTypeId != null && !localReservation.room_type) {
      reservationPatch.room_type = String(roomTypeId);
    }
    if (roomTypeDetails?.code) {
      reservationPatch.rate_code = roomTypeDetails.code;
    }
    if (customerSpecialRequest) {
      reservationPatch.customer_special_request = customerSpecialRequest;
    }

    const updated = await this.roomReservationService.updateReservationRecord(
      localReservation.id,
      reservationPatch,
      trx,
    );
    if (!updated) {
      throw new Error(
        `StayntouchReservationSyncService: Reservation update returned no row for id=${localReservation.id}`,
      );
    }

    logger.info('StayntouchReservationSyncService: Reservation updated', {
      externalReservationId: reservation.id,
      reservationId: updated.id,
      mappedReservationStatus: newStatus,
      previousStatus: localReservation.status,
    });

    return updated;
  }

  private async insertSession(
    reservation: GetReservationResponse,
    hotel: Hotel,
    trx: Knex.Transaction,
  ): Promise<Session> {
    const callerPhone = this.resolveCallerPhoneNumber(
      reservation.guests,
      hotel,
    );
    const assistantPhone = hotel.assistant_phone_number || DUMMY_PHONE_NUMBER;
    logger.info('StayntouchReservationSyncService: Mapping session data', {
      externalReservationId: reservation.id,
      confirmationNumber: reservation.confirmation_number,
      hotelId: hotel.id,
      guestCount: reservation.guests?.length ?? 0,
      usedDummyCallerPhone: callerPhone === DUMMY_PHONE_NUMBER,
      sessionStatus: StatusUpdateType.Ended,
      sessionType: SessionType.EXTERNAL,
    });

    const sessionData: Partial<Session> = {
      caller_phone_number: callerPhone,
      assistant_phone_number: assistantPhone,
      session_status: StatusUpdateType.Ended,
      session_type: SessionType.EXTERNAL,
      hotel_id: hotel.id,
      has_unread_messages: false,
      metadata: null,
      created_at: this.parseDate(reservation.created_time) ?? new Date(),
      updated_at: this.parseDate(reservation.updated_time) ?? new Date(),
    };

    return this.sessionService.createExternalSession(sessionData, trx);
  }

  private async insertCustomer(
    reservation: GetReservationResponse,
    hotel: Hotel,
    trx: Knex.Transaction,
  ): Promise<CustomerDTO> {
    const primaryGuest = this.resolvePrimaryGuest(reservation.guests);
    const primaryGuestPhone = this.formatGuestPhone(primaryGuest, hotel);
    logger.info('StayntouchReservationSyncService: Mapping customer data', {
      externalReservationId: reservation.id,
      confirmationNumber: reservation.confirmation_number,
      hotelId: hotel.id,
      selectedGuestId: primaryGuest?.id,
      selectedGuestIsPrimary: primaryGuest?.is_primary ?? false,
      hasGuestPhone: !!primaryGuestPhone,
      hasGuestEmail: !!primaryGuest?.email?.trim(),
      hasContactAddress: !!primaryGuest?.address,
      hasBillingAddress: !!primaryGuest?.billing_address,
    });

    const customerData: Partial<CustomerDTO> = {
      first_name: primaryGuest?.first_name?.trim() || undefined,
      last_name: primaryGuest?.last_name?.trim() || undefined,
      phone_number: primaryGuestPhone ?? DUMMY_PHONE_NUMBER,
      email: primaryGuest?.email?.trim() || undefined,
      hotel_id: hotel.id,
      payment_provider_customer_id: undefined,
      address: this.mapGuestAddress(primaryGuest?.address),
      billing_address: this.mapGuestAddress(primaryGuest?.billing_address),
      signature: null,
      device_details: null,
      card_metadata: null,
    };

    return this.customerService.createCustomer(customerData, trx);
  }

  private async insertReservation(
    reservation: GetReservationResponse,
    hotel: Hotel,
    customerId: string,
    sessionId: string,
    trx: Knex.Transaction,
  ): Promise<Reservation> {
    const firstStayDate = reservation.stay_dates?.[0];
    const roomTypeId = firstStayDate?.room_type_id;
    const roomTypeDetails = this.findRoomTypeDetails(hotel, roomTypeId);

    const reservationStatus = this.mapReservationStatus(reservation.status);
    const phoneNumber = this.resolveCallerPhoneNumber(
      reservation.guests,
      hotel,
    );
    const customerSpecialRequest = this.extractFirstNoteText(reservation);
    logger.info('StayntouchReservationSyncService: Mapping reservation data', {
      externalReservationId: reservation.id,
      confirmationNumber: reservation.confirmation_number,
      hotelId: hotel.id,
      customerId,
      sessionId,
      stayntouchStatus: reservation.status,
      mappedReservationStatus: reservationStatus,
      roomTypeId,
      roomTypeName: roomTypeDetails?.name,
      rateCode: roomTypeDetails?.code ?? null,
      usedFallbackRoomType: !roomTypeDetails,
      usedDummyReservationPhone: phoneNumber === DUMMY_PHONE_NUMBER,
      hasCustomerSpecialRequest: !!customerSpecialRequest,
      checkIn: reservation.arrival_date,
      checkOut: reservation.departure_date,
    });

    const reservationData: Omit<
      Reservation,
      'id' | 'created_at' | 'updated_at'
    > & {
      created_at?: Date;
      updated_at?: Date;
    } = {
      booking_id: generateBookingId(),
      business_id: String(reservation.hotel_id),
      hotel_id: hotel.id,
      pms_provider: PmsProvider.STAYNTOUCH,
      room_id: roomTypeId ?? 0,
      customer_id: customerId,
      session_id: sessionId,
      check_in: this.parseDateOnly(reservation.arrival_date, hotel.timezone),
      check_out: this.parseDateOnly(reservation.departure_date, hotel.timezone),
      num_adults: firstStayDate?.adults ?? 0,
      num_children: firstStayDate?.children ?? 0,
      phone_number: phoneNumber,
      status: reservationStatus,
      previous_status: reservationStatus,
      notes_from_partner: undefined,
      room_type:
        roomTypeDetails?.name ?? (roomTypeId != null ? String(roomTypeId) : ''),
      customer_special_request: customerSpecialRequest ?? undefined,
      external_id: String(reservation.id),
      external_public_id: reservation.confirmation_number,
      type: SessionType.EXTERNAL,
      source: mapStayntouchSourceCodeToReservationSource(
        reservation.source_code,
      ),
      auto_charge: undefined,
      payment_status: undefined,
      onboarding_sms_sent: false,
      rate_code: roomTypeDetails?.code ?? null,
      created_at: this.parseDate(reservation.created_time) ?? new Date(),
      updated_at: this.parseDate(reservation.updated_time) ?? new Date(),
    };

    return this.roomReservationService.createReservationRecord(
      reservationData as Omit<Reservation, 'id' | 'created_at' | 'updated_at'>,
      trx,
    );
  }

  private async insertPaymentsForPaymentTransactions(
    reservation: GetReservationResponse,
    hotel: Hotel,
    reservationId: string,
    trx: Knex.Transaction,
  ): Promise<Payment[]> {
    const paymentTransactions = this.collectPaymentTransactions(reservation);
    const defaultCurrency = this.resolvePaymentCurrency(hotel);
    const createdPayments: Payment[] = [];

    logger.info('StayntouchReservationSyncService: Mapping payment data', {
      externalReservationId: reservation.id,
      confirmationNumber: reservation.confirmation_number,
      hotelId: hotel.id,
      billCount: reservation.bills?.length ?? 0,
      paymentTransactionCount: paymentTransactions.length,
    });

    for (const transaction of paymentTransactions) {
      const amountCharged = this.getTransactionAmount(transaction);
      const currency = transaction.currency_code?.trim() || defaultCurrency;
      const paymentStatus = PaymentStatus.COMPLETED;

      // By default for now payment status is commpleted
      // so the check is redundant but keeping it for future reference
      const notificationCount =
        paymentStatus === PaymentStatus.COMPLETED
          ? 0
          : config.PAYMENT_REMINDER_NOTIFICATION_LIMIT;

      const paymentData = {
        hotel_id: hotel.id,
        amount_charged: amountCharged,
        currency,
        payment_status: paymentStatus,
        payment_provider: PaymentProvider.UNKNOWN,
        notification_count: notificationCount,
      } as Omit<
        Payment,
        'id' | 'created_at' | 'updated_at' | 'payment_link' | 'payment_link_id'
      >;

      const payment = await this.paymentService.createPaymentWithoutLink(
        paymentData,
        trx,
      );
      await this.paymentService.linkPaymentToReservations(
        payment.id,
        [reservationId],
        trx,
      );
      createdPayments.push(payment);
      logger.info('StayntouchReservationSyncService: Payment inserted', {
        externalReservationId: reservation.id,
        confirmationNumber: reservation.confirmation_number,
        hotelId: hotel.id,
        paymentId: payment.id,
        amountCharged: payment.amount_charged,
        currency: payment.currency,
        paymentStatus: payment.payment_status,
      });
    }

    return createdPayments;
  }

  // -------------------- mapping helpers --------------------

  private resolvePrimaryGuest(
    guests: GetReservationGuestResponse[] | undefined,
  ): GetReservationGuestResponse | undefined {
    if (!guests?.length) return undefined;
    return guests.find((g) => g.is_primary) ?? guests[0];
  }

  /**
   * Per spec: primary guest's mobile_phone -> first guest with a phone ->
   * DUMMY_PHONE_NUMBER.
   */
  private resolveCallerPhoneNumber(
    guests: GetReservationGuestResponse[] | undefined,
    hotel: Hotel,
  ): string {
    if (!guests?.length) return DUMMY_PHONE_NUMBER;

    const primary = guests.find((g) => g.is_primary);
    const primaryPhone = this.formatGuestPhone(primary, hotel);
    if (primaryPhone) return primaryPhone;

    for (const guest of guests) {
      const phone = this.formatGuestPhone(guest, hotel);
      if (phone) return phone;
    }

    return DUMMY_PHONE_NUMBER;
  }

  private formatGuestPhone(
    guest: GetReservationGuestResponse | undefined,
    hotel: Hotel,
  ): string | undefined {
    if (!guest?.mobile_phone?.trim()) return undefined;

    const country = this.resolvePhoneCountry(
      guest.address?.country_code ?? guest.billing_address?.country_code,
      hotel,
    );

    try {
      return formatPhoneNumber(guest.mobile_phone, country);
    } catch (error) {
      logger.warn(
        'StayntouchReservationSyncService: Unable to format guest phone number',
        {
          guestId: guest.id,
          hotelId: hotel.id,
          country,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return undefined;
    }
  }

  private resolvePhoneCountry(
    countryCode: string | undefined,
    hotel: Hotel,
  ): Country {
    const normalized = countryCode?.trim().toUpperCase();
    if (normalized === Country.US || normalized === Country.UK) {
      return normalized;
    }
    return hotel.country;
  }

  private mapGuestAddress(
    address:
      | GetReservationGuestResponse['address']
      | GetReservationGuestResponse['billing_address']
      | undefined,
  ): AddressDTO | undefined {
    if (!address) return undefined;

    const mapped: AddressDTO = {
      address_first_line:
        [address.address_line1, address.address_line2]
          .filter((value): value is string => Boolean(value?.trim()))
          .join(', ') || undefined,
      city: address.city?.trim() || undefined,
      state_or_province: address.state?.trim() || undefined,
      postal_code: address.postal_code?.trim() || undefined,
      country: address.country_code?.trim() || undefined,
    };

    const hasAnyValue = Object.values(mapped).some(
      (value) => value !== undefined && value !== null && value !== '',
    );
    return hasAnyValue ? mapped : undefined;
  }

  /**
   * StayNTouch status strings (RESERVED, CHECKEDIN, CHECKEDOUT, NOSHOW, CANCELED)
   * -> internal ReservationStatus enum. Anything we don't
   * explicitly recognise is treated as ACTIVE so the booking is still
   * persisted instead of being silently dropped.
   */
  private mapReservationStatus(status: string | undefined): ReservationStatus {
    if (!status) return ReservationStatus.ACTIVE;
    const normalized = status.toUpperCase();

    switch (normalized) {
      case 'CANCELED':
        return ReservationStatus.CANCELLED;
      case 'NOSHOW':
        return ReservationStatus.NO_SHOW;
      case 'CHECKEDIN':
      case 'CHECKEDOUT':
        return ReservationStatus.ACTIVE;
      default:
        return ReservationStatus.ACTIVE;
    }
  }

  private findRoomTypeDetails(
    hotel: Hotel,
    roomTypeId: number | undefined,
  ): RoomTypeDetails | undefined {
    if (roomTypeId == null) return undefined;
    const results = hotel.room_types?.results;
    if (!results?.length) return undefined;
    return results.find((rt) => rt.id === roomTypeId);
  }

  private extractFirstNoteText(
    reservation: GetReservationResponse,
  ): string | null {
    const notes = reservation.notes;
    if (!notes?.length) return null;

    for (const note of notes) {
      const text = note?.text ?? note?.note;
      if (typeof text === 'string' && text.trim().length > 0) {
        return text.trim();
      }
    }
    return null;
  }

  private collectBillTransactions(
    reservation: GetReservationResponse,
  ): GetReservationBillTransactionResponse[] {
    const transactions: GetReservationBillTransactionResponse[] = [];
    for (const bill of reservation.bills ?? []) {
      for (const tx of bill.transactions ?? []) {
        transactions.push(tx);
      }
    }
    return transactions;
  }

  private collectPaymentTransactions(
    reservation: GetReservationResponse,
  ): GetReservationBillTransactionResponse[] {
    const paymentCodes: string[] = Object.values(StayntouchChargeCode);
    return this.collectBillTransactions(reservation).filter(
      (tx) =>
        tx.charge_code_type?.toUpperCase() === 'PAYMENT' &&
        paymentCodes.includes(tx.charge_code?.toUpperCase() ?? ''),
    );
  }

  private getTransactionAmount(
    transaction: GetReservationBillTransactionResponse,
  ): number {
    const raw = transaction.amount;
    const numeric = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  /**
   * Resolves currency from the hotel's country (per plan): US -> USD, UK ->
   * GBP. Anything outside the supported set falls back to the sentinel string
   * 'unavailable' as specified in the feature doc.
   */
  private resolvePaymentCurrency(hotel: Hotel): string {
    switch (hotel.country) {
      case Country.US:
        return Currency['$'];
      case Country.UK:
        return Currency['£'];
      default:
        return DEFAULT_CURRENCY;
    }
  }

  private parseDate(value: string | undefined): Date | undefined {
    if (!value) return undefined;
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.toDate() : undefined;
  }

  private parseDateOnly(value: string, timezone: string): Date {
    const parsed = dayjs.tz(value, timezone);
    if (!parsed.isValid()) {
      throw new Error(
        `StayntouchReservationSyncService: Invalid date value ${value}`,
      );
    }

    // Return a date-only value to avoid shifting the reservation date through
    // the server timezone before Postgres stores it in a DATE column.
    return parsed.format('YYYY-MM-DD') as unknown as Date;
  }
}

export const stayntouchReservationSyncService =
  new StayntouchReservationSyncService();
