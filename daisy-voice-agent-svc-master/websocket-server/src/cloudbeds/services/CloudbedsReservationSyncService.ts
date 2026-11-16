/**
 * CloudbedsReservationSyncService
 *
 * Persists Cloudbeds webhook reservation events into the Daisy database.
 * Follows the same pattern as StayntouchReservationSyncService.
 *
 * syncCreateReservation: session -> customer -> reservation (in a transaction)
 * syncUpdateReservation: updates customer + reservation fields
 * findLocalReservation: checks if we already have this reservation
 */

import { Knex } from 'knex';
import db from '../../database/connection';
import { Customer as CustomerDTO } from '../../dtos/Customer';
import { ReservationSource } from '../../dtos/enum/ReservationSource';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { DAISY_SESSION_TYPES, SessionType } from '../../dtos/enum/SessionType';
import { Hotel } from '../../models/Hotel';
import { Reservation } from '../../models/Reservation';
import { Session } from '../../models/Session';
import { StatusUpdateType } from '../../models/request/StatusUpdate';
import { PmsProvider } from '../../types/enums';
import { generateBookingId } from '../../utils/helper';
import logger from '../../utils/logger';
import {
  CloudbedsGetReservationGuestEntry,
  CloudbedsGetReservationResponseData,
} from '../types';

import customerServiceInstance, {
  CustomerService,
} from '../../services/customer/customerService';
import roomReservationServiceInstance, {
  RoomReservationService,
} from '../../services/roomReservation/roomReservationService';
import sessionServiceInstance, {
  SessionService,
} from '../../services/session/SessionService';

const DUMMY_PHONE_NUMBER = '+10000000000';

export class CloudbedsReservationSyncService {
  constructor(
    private readonly sessionService: SessionService = sessionServiceInstance,
    private readonly customerService: CustomerService = customerServiceInstance,
    private readonly roomReservationService: RoomReservationService = roomReservationServiceInstance,
  ) {}

  /**
   * Looks up an existing Daisy reservation by its Cloudbeds reservationID.
   * Returns null if we've never synced this reservation before.
   */
  async findLocalReservation(
    hotel: Hotel,
    reservationID: string,
  ): Promise<Reservation | null> {
    return this.roomReservationService.findReservationByHotelPmsAndExternalIdentifiers(
      hotel.id,
      PmsProvider.CLOUDBEDS,
      reservationID,
    );
  }

  /**
   * A reservation is Daisy-originated if it was booked through a Daisy
   * channel (call/chat/sms/web) as a direct hotel reservation, rather than
   * synced in from an external source (e.g. an OTA or the Cloudbeds dashboard).
   */
  isDaisyOriginatedReservation(reservation: Reservation): boolean {
    const daisySessionTypes: string[] = Object.values(DAISY_SESSION_TYPES);

    return (
      daisySessionTypes.includes(reservation.type) &&
      reservation.source === ReservationSource.DIRECT_HOTEL_RESERVATION
    );
  }

  /**
   * Creates a full reservation record from a Cloudbeds webhook in a single
   * database transaction: session -> customer -> reservation.
   *
   * If anything fails, the entire transaction rolls back.
   */
  async syncCreateReservation(
    fullReservation: CloudbedsGetReservationResponseData,
    hotel: Hotel,
  ): Promise<{ reservationId: string }> {
    const reservationID = fullReservation.reservationID;

    logger.info(
      'CloudbedsReservationSyncService: Starting syncCreateReservation',
      {
        reservationID,
        hotelId: hotel.id,
        propertyID: fullReservation.propertyID,
      },
    );

    const trx = await db.transaction();
    try {
      const session = await this.insertSession(hotel, trx);
      logger.info('CloudbedsReservationSyncService: Session inserted', {
        reservationID,
        hotelId: hotel.id,
        sessionId: session.id,
      });

      const mainGuest = this.resolveMainGuest(fullReservation.guestList);
      const customer = await this.insertCustomer(mainGuest, hotel, trx);
      if (!customer.id) {
        throw new Error(
          'CloudbedsReservationSyncService: Customer creation did not return an id',
        );
      }
      logger.info('CloudbedsReservationSyncService: Customer inserted', {
        reservationID,
        hotelId: hotel.id,
        customerId: customer.id,
      });

      const reservation = await this.insertReservation(
        fullReservation,
        hotel,
        customer.id,
        session.id,
        mainGuest,
        trx,
      );
      logger.info('CloudbedsReservationSyncService: Reservation inserted', {
        reservationID,
        hotelId: hotel.id,
        reservationId: reservation.id,
        bookingId: reservation.booking_id,
      });

      await trx.commit();

      logger.info(
        'CloudbedsReservationSyncService: syncCreateReservation completed',
        {
          reservationID,
          hotelId: hotel.id,
          reservationId: reservation.id,
        },
      );

      return { reservationId: reservation.id };
    } catch (error) {
      await trx.rollback().catch((rollbackErr) => {
        logger.error(
          'CloudbedsReservationSyncService: Transaction rollback failed',
          { rollbackErr },
        );
      });
      logger.error(
        'CloudbedsReservationSyncService: syncCreateReservation failed',
        {
          error,
          reservationID,
          hotelId: hotel.id,
        },
      );
      throw error;
    }
  }

  /**
   * Updates an existing local reservation with latest data from Cloudbeds.
   * Used when we receive a duplicate webhook or a retry.
   */
  async syncUpdateReservation(
    fullReservation: CloudbedsGetReservationResponseData,
    hotel: Hotel,
    localReservation: Reservation,
  ): Promise<{ reservationId: string }> {
    const reservationID = fullReservation.reservationID;

    logger.info(
      'CloudbedsReservationSyncService: Starting syncUpdateReservation',
      {
        reservationID,
        hotelId: hotel.id,
        localReservationId: localReservation.id,
      },
    );

    const trx = await db.transaction();
    try {
      const mainGuest = this.resolveMainGuest(fullReservation.guestList);

      if (localReservation.customer_id) {
        await this.updateCustomer(mainGuest, localReservation.customer_id, trx);
      }

      const reservationPatch = this.buildReservationPatch(
        fullReservation,
        hotel,
        mainGuest,
        localReservation,
      );

      const updated = await this.roomReservationService.updateReservationRecord(
        localReservation.id,
        reservationPatch,
        trx,
      );

      if (!updated) {
        throw new Error(
          `CloudbedsReservationSyncService: Reservation update returned no row for id=${localReservation.id}`,
        );
      }

      await trx.commit();

      logger.info(
        'CloudbedsReservationSyncService: syncUpdateReservation completed',
        {
          reservationID,
          hotelId: hotel.id,
          reservationId: updated.id,
        },
      );

      return { reservationId: updated.id };
    } catch (error) {
      await trx.rollback().catch((rollbackErr) => {
        logger.error(
          'CloudbedsReservationSyncService: Transaction rollback failed',
          { rollbackErr },
        );
      });
      logger.error(
        'CloudbedsReservationSyncService: syncUpdateReservation failed',
        {
          error,
          reservationID,
          hotelId: hotel.id,
          localReservationId: localReservation.id,
        },
      );
      throw error;
    }
  }

  // ==================== HELPERS ====================

  /**
   * Extracts the main guest from Cloudbeds' guestList.
   * guestList is a Record<string, GuestEntry> (NOT an array).
   * Finds the entry where isMainGuest === true, falls back to first entry.
   */
  resolveMainGuest(
    guestList: Record<string, CloudbedsGetReservationGuestEntry> | undefined,
  ): CloudbedsGetReservationGuestEntry | undefined {
    if (!guestList) return undefined;
    const guests = Object.values(guestList);
    if (guests.length === 0) return undefined;
    return guests.find((g) => g.isMainGuest === true) ?? guests[0];
  }

  /**
   * Maps Cloudbeds reservation status to Daisy's ReservationStatus enum.
   *
   * confirmed / not_confirmed / in_progress / checked_in / checked_out -> ACTIVE
   * canceled -> CANCELLED
   * no_show -> NO_SHOW
   */
  mapReservationStatus(status: string | undefined): ReservationStatus {
    if (!status) return ReservationStatus.ACTIVE;
    const normalized = status.toLowerCase();

    switch (normalized) {
      case 'canceled':
        return ReservationStatus.CANCELLED;
      case 'no_show':
        return ReservationStatus.NO_SHOW;
      case 'confirmed':
      case 'not_confirmed':
      case 'in_progress':
      case 'checked_in':
      case 'checked_out':
        return ReservationStatus.ACTIVE;
      default:
        return ReservationStatus.ACTIVE;
    }
  }

  // ==================== PRIVATE ====================

  private async insertSession(
    hotel: Hotel,
    trx: Knex.Transaction,
  ): Promise<Session> {
    const sessionData: Partial<Session> = {
      caller_phone_number: DUMMY_PHONE_NUMBER,
      assistant_phone_number:
        hotel.assistant_phone_number || DUMMY_PHONE_NUMBER,
      session_status: StatusUpdateType.Ended,
      session_type: SessionType.EXTERNAL,
      hotel_id: hotel.id,
      has_unread_messages: false,
      metadata: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    return this.sessionService.createExternalSession(sessionData, trx);
  }

  private async insertCustomer(
    mainGuest: CloudbedsGetReservationGuestEntry | undefined,
    hotel: Hotel,
    trx: Knex.Transaction,
  ): Promise<CustomerDTO> {
    const phone =
      mainGuest?.guestPhone?.trim() ||
      mainGuest?.guestCellPhone?.trim() ||
      DUMMY_PHONE_NUMBER;

    const customerData: Partial<CustomerDTO> = {
      first_name: mainGuest?.guestFirstName?.trim() || undefined,
      last_name: mainGuest?.guestLastName?.trim() || undefined,
      phone_number: phone,
      email: mainGuest?.guestEmail?.trim() || undefined,
      hotel_id: hotel.id,
      address: this.mapGuestAddress(mainGuest),
    };

    return this.customerService.createCustomer(customerData, trx);
  }

  private async insertReservation(
    fullReservation: CloudbedsGetReservationResponseData,
    hotel: Hotel,
    customerId: string,
    sessionId: string,
    mainGuest: CloudbedsGetReservationGuestEntry | undefined,
    trx: Knex.Transaction,
  ): Promise<Reservation> {
    const room =
      fullReservation.assigned?.[0] ?? fullReservation.unassigned?.[0];
    const status = this.mapReservationStatus(fullReservation.status);
    const phone =
      mainGuest?.guestPhone?.trim() ||
      mainGuest?.guestCellPhone?.trim() ||
      DUMMY_PHONE_NUMBER;

    const adults = room?.adults != null ? parseInt(String(room.adults), 10) : 1;
    const children =
      room?.children != null ? parseInt(String(room.children), 10) : 0;

    const reservationData: Omit<
      Reservation,
      'id' | 'created_at' | 'updated_at'
    > = {
      booking_id: generateBookingId(),
      business_id: String(fullReservation.propertyID ?? hotel.business_id),
      hotel_id: hotel.id,
      pms_provider: PmsProvider.CLOUDBEDS,
      room_id: room?.roomTypeID ?? '0',
      customer_id: customerId,
      session_id: sessionId,
      check_in: fullReservation.startDate as unknown as Date,
      check_out: fullReservation.endDate as unknown as Date,
      num_adults: adults,
      num_children: children,
      phone_number: phone,
      status,
      previous_status: status,
      room_type: room?.roomTypeName ?? '',
      external_id: fullReservation.reservationID,
      type: SessionType.EXTERNAL,
      source: ReservationSource.DIRECT_HOTEL_RESERVATION,
      onboarding_sms_sent: false,
    };

    return this.roomReservationService.createReservationRecord(
      reservationData,
      trx,
    );
  }

  private async updateCustomer(
    mainGuest: CloudbedsGetReservationGuestEntry | undefined,
    customerId: string,
    trx: Knex.Transaction,
  ): Promise<void> {
    if (!mainGuest) return;

    const customerPatch: Partial<CustomerDTO> = {};

    const firstName = mainGuest.guestFirstName?.trim();
    if (firstName) customerPatch.first_name = firstName;

    const lastName = mainGuest.guestLastName?.trim();
    if (lastName) customerPatch.last_name = lastName;

    const email = mainGuest.guestEmail?.trim();
    if (email) customerPatch.email = email;

    const phone =
      mainGuest.guestPhone?.trim() || mainGuest.guestCellPhone?.trim();
    if (phone) customerPatch.phone_number = phone;

    if (Object.keys(customerPatch).length === 0) return;

    await this.customerService.updateCustomer(customerId, customerPatch, trx);
  }

  private buildReservationPatch(
    fullReservation: CloudbedsGetReservationResponseData,
    hotel: Hotel,
    mainGuest: CloudbedsGetReservationGuestEntry | undefined,
    localReservation: Reservation,
  ): Partial<Omit<Reservation, 'id' | 'created_at' | 'updated_at'>> {
    const room =
      fullReservation.assigned?.[0] ?? fullReservation.unassigned?.[0];
    if (!room) {
      logger.warn(
        'CloudbedsReservationSyncService: No room assignment in API response, room fields will not be updated',
        {
          reservationID: fullReservation.reservationID,
          localReservationId: localReservation.id,
        },
      );
    }
    const newStatus = this.mapReservationStatus(fullReservation.status);
    const phone =
      mainGuest?.guestPhone?.trim() || mainGuest?.guestCellPhone?.trim();

    const patch: Partial<
      Omit<Reservation, 'id' | 'created_at' | 'updated_at'>
    > = {
      status: newStatus,
      previous_status: localReservation.status,
      check_in: fullReservation.startDate as unknown as Date,
      check_out: fullReservation.endDate as unknown as Date,
      business_id: String(fullReservation.propertyID ?? hotel.business_id),
      external_id: fullReservation.reservationID,
    };

    if (room?.roomTypeID) {
      patch.room_id = room.roomTypeID;
    }
    if (room?.roomTypeName) {
      patch.room_type = room.roomTypeName;
    }
    if (room?.adults != null) {
      patch.num_adults = parseInt(String(room.adults), 10);
    }
    if (room?.children != null) {
      patch.num_children = parseInt(String(room.children), 10);
    }
    if (phone) {
      patch.phone_number = phone;
    }

    return patch;
  }

  private mapGuestAddress(
    guest: CloudbedsGetReservationGuestEntry | undefined,
  ) {
    if (!guest) return undefined;

    const address = {
      address_first_line: guest.guestAddress?.trim() || undefined,
      city: guest.guestCity?.trim() || undefined,
      state_or_province: guest.guestState?.trim() || undefined,
      postal_code: guest.guestZip?.trim() || undefined,
      country: guest.guestCountry?.trim() || undefined,
    };

    const hasAnyValue = Object.values(address).some(
      (v) => v !== undefined && v !== '',
    );
    return hasAnyValue ? address : undefined;
  }
}

export const cloudbedsReservationSyncService =
  new CloudbedsReservationSyncService();
