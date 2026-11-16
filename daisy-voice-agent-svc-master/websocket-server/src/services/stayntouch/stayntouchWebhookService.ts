import { CancellationSource } from '../../dtos/enum/CancellationSource';
import { ReservationSource } from '../../dtos/enum/ReservationSource';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { DAISY_SESSION_TYPES } from '../../dtos/enum/SessionType';
import { StayntouchClient } from '../../stayntouch/client/StayntouchClient';
import { PmsProvider } from '../../types/enums';
import { StayntouchEvent, WebhookResponse } from '../../types/stayntouch.types';
import logger from '../../utils/logger';
import {
  HotelService,
  hotelService as hotelServiceInstance,
} from '../hotel/hotelService';
import roomReservationServiceInstance, {
  RoomReservationService,
} from '../roomReservation/roomReservationService';
import {
  StayntouchReservationSyncService,
  stayntouchReservationSyncService,
} from './StayntouchReservationSyncService';

export class StayntouchWebhookService {
  constructor(
    private readonly hotelService: HotelService = hotelServiceInstance,
    private readonly reservationSyncService: StayntouchReservationSyncService = stayntouchReservationSyncService,
    private readonly roomReservationService: RoomReservationService = roomReservationServiceInstance,
  ) {}

  async handleWebhookEvent(event: StayntouchEvent): Promise<WebhookResponse> {
    logger.info(
      `StayntouchWebhookService: Received event type=${event?.event}, id=${event?.id}`,
    );

    if (!event?.data) {
      logger.warn(
        'StayntouchWebhookService: Ignoring webhook event without data payload',
        {
          eventId: event?.id,
          eventType: event?.event,
        },
      );
      return {
        success: true,
        message:
          'StayNTouch webhook event ignored because data payload is missing',
      };
    }

    const hotelId = this.normalizeHotelId(event.data.hotel_id);
    event.data.hotel_id = hotelId;

    switch (event.event) {
      case 'cancel_reservation':
        return await this.handleCancelReservation(event);
      //   case 'create_reservation':
      //     return await this.handleCreateReservation(event);
      //   case 'edit_reservation':
      //     return await this.handleEditReservation(event);
      //   case 'checkin_completed':
      //     return await this.handleCheckinCompleted(event);
      //   case 'checkedout':
      //     return await this.handleCheckedout(event);
      //   default:
      //     logger.warn(`StayntouchWebhookService: Ignoring unknown event type=${event.event}`);
      //     return {
      //       success: true,
      //       message: `Event type ${event.event} ignored`,
      //     };
    }
    return { success: true, message: `Event type ${event.event} ignored` };
  }

  private normalizeHotelId(hotelId: string | number): string {
    return String(hotelId);
  }

  private async handleCreateReservation(
    event: StayntouchEvent,
  ): Promise<WebhookResponse> {
    if (!event.data) {
      logger.warn(
        'StayntouchWebhookService: Ignoring create_reservation event without data payload',
        {
          eventId: event.id,
          eventType: event.event,
        },
      );
      return {
        success: true,
        message:
          'StayNTouch create_reservation event ignored because data payload is missing',
      };
    }

    const externalReservationId = event.data.id;
    const stayntouchHotelId = event.data.hotel_id;
    logger.info(
      `StayntouchWebhookService: Processing create_reservation external_id=${externalReservationId} confirmation=${event.data.confirmation_number} hotel_id=${stayntouchHotelId}`,
    );

    try {
      logger.info(
        'StayntouchWebhookService: Looking up internal hotel for StayNTouch reservation',
        {
          stayntouchHotelId,
          externalReservationId,
          confirmationNumber: event.data.confirmation_number,
        },
      );

      const hotel =
        await this.hotelService.getHotelByBusinessId(stayntouchHotelId);
      if (!hotel) {
        logger.warn(
          'StayntouchWebhookService: No hotel found for StayNTouch hotel_id',
          {
            stayntouchHotelId,
            externalReservationId,
            confirmationNumber: event.data.confirmation_number,
          },
        );
        return {
          success: true,
          message: `No hotel registered for StayNTouch hotel_id=${stayntouchHotelId}`,
          reservation_id: event.data.id?.toString() ?? 'unknown',
        };
      }

      logger.info(
        'StayntouchWebhookService: Internal hotel resolved for StayNTouch reservation',
        {
          stayntouchHotelId,
          externalReservationId,
          hotelId: hotel.id,
          hotelName: hotel.name,
          hotelBusinessId: hotel.business_id,
        },
      );

      const client = new StayntouchClient(hotel.id);
      logger.info(
        'StayntouchWebhookService: Fetching full reservation from StayNTouch',
        {
          hotelId: hotel.id,
          externalReservationId,
        },
      );

      const fullReservation = await client.getReservation(
        String(externalReservationId),
      );

      logger.info(
        'StayntouchWebhookService: Full StayNTouch reservation fetched',
        {
          hotelId: hotel.id,
          externalReservationId: fullReservation.id,
          confirmationNumber: fullReservation.confirmation_number,
          guestCount: fullReservation.guests?.length ?? 0,
          billCount: fullReservation.bills?.length ?? 0,
          stayDateCount: fullReservation.stay_dates?.length ?? 0,
        },
      );

      const { reservationId } =
        await this.reservationSyncService.syncCreateReservation(
          fullReservation,
          hotel,
          event,
        );

      logger.info(
        'StayntouchWebhookService: create_reservation sync completed',
        {
          hotelId: hotel.id,
          externalReservationId: fullReservation.id,
          confirmationNumber: fullReservation.confirmation_number,
          reservationId,
        },
      );

      return {
        success: true,
        message: 'Reservation synced from StayNTouch',
        reservation_id: reservationId,
      };
    } catch (error) {
      const err = error as Error;
      logger.error(
        `StayntouchWebhookService: handleCreateReservation failed: ${err.message}. Raw event=${JSON.stringify(event)}`,
        { error: err },
      );
      return {
        success: false,
        message: `Failed to process create_reservation: ${err.message}`,
        reservation_id: event.data.confirmation_number,
      };
    }
  }

  private async handleEditReservation(
    event: StayntouchEvent,
  ): Promise<WebhookResponse> {
    if (!event.data) {
      logger.warn(
        'StayntouchWebhookService: Ignoring edit_reservation event without data payload',
        {
          eventId: event.id,
          eventType: event.event,
        },
      );
      return {
        success: true,
        message:
          'StayNTouch edit_reservation event ignored because data payload is missing',
      };
    }

    const externalReservationId = event.data.id;
    const stayntouchHotelId = event.data.hotel_id;
    logger.info(
      `StayntouchWebhookService: Processing edit_reservation external_id=${externalReservationId} confirmation=${event.data.confirmation_number} hotel_id=${stayntouchHotelId}`,
    );

    try {
      const hotel =
        await this.hotelService.getHotelByBusinessId(stayntouchHotelId);
      if (!hotel) {
        logger.warn(
          'StayntouchWebhookService: No hotel found for StayNTouch hotel_id',
          {
            stayntouchHotelId,
            externalReservationId,
            confirmationNumber: event.data.confirmation_number,
          },
        );
        return {
          success: true,
          message: `No hotel registered for StayNTouch hotel_id=${stayntouchHotelId}`,
          reservation_id: event.data.id?.toString() ?? 'unknown',
        };
      }

      const client = new StayntouchClient(hotel.id);
      const fullReservation = await client.getReservation(
        String(externalReservationId),
      );

      logger.info(
        'StayntouchWebhookService: Full StayNTouch reservation fetched for edit',
        {
          hotelId: hotel.id,
          externalReservationId: fullReservation.id,
          confirmationNumber: fullReservation.confirmation_number,
        },
      );

      const localReservation =
        await this.reservationSyncService.findLocalReservation(
          hotel,
          fullReservation,
        );

      if (!localReservation) {
        logger.warn(
          'StayntouchWebhookService: No local reservation for edit_reservation — skipping update (await create_reservation)',
          {
            hotelId: hotel.id,
            externalReservationId: fullReservation.id,
            confirmationNumber: fullReservation.confirmation_number,
          },
        );

        return {
          success: true,
          message:
            'No local reservation to update; edit_reservation ignored until create_reservation is processed',
          reservation_id: String(fullReservation.id),
        };
      }

      const { reservationId } =
        await this.reservationSyncService.syncEditReservation(
          fullReservation,
          hotel,
          localReservation,
          event,
        );

      logger.info('StayntouchWebhookService: edit_reservation sync completed', {
        hotelId: hotel.id,
        externalReservationId: fullReservation.id,
        confirmationNumber: fullReservation.confirmation_number,
        reservationId,
      });

      return {
        success: true,
        message: 'Reservation updated from StayNTouch',
        reservation_id: reservationId,
      };
    } catch (error) {
      const err = error as Error;
      logger.error(
        `StayntouchWebhookService: handleEditReservation failed: ${err.message}. Raw event=${JSON.stringify(event)}`,
        { error: err },
      );
      return {
        success: false,
        message: `Failed to process edit_reservation: ${err.message}`,
        reservation_id: event.data.confirmation_number,
      };
    }
  }

  private async handleCancelReservation(
    event: StayntouchEvent,
  ): Promise<WebhookResponse> {
    const externalReservationId = String(event.data.id);
    const stayntouchHotelId = event.data.hotel_id;
    const confirmationNumber = event.data.confirmation_number;

    logger.info(
      `StayntouchWebhookService: Processing cancel_reservation external_id=${externalReservationId} confirmation=${confirmationNumber} hotel_id=${stayntouchHotelId}`,
    );

    // ─── Step 1: Look up hotel by StayNTouch hotel_id ───
    const hotel =
      await this.hotelService.getHotelByBusinessId(stayntouchHotelId);
    if (!hotel) {
      logger.warn(
        'StayntouchWebhookService: No hotel found for StayNTouch hotel_id',
        { stayntouchHotelId, externalReservationId, confirmationNumber },
      );
      return {
        success: true,
        message: `No hotel registered for StayNTouch hotel_id=${stayntouchHotelId}`,
        reservation_id: confirmationNumber,
      };
    }

    // ─── Step 2: Find local reservation ───
    const localReservation =
      await this.roomReservationService.findReservationByHotelPmsAndExternalIdentifiers(
        hotel.id,
        PmsProvider.STAYNTOUCH,
        externalReservationId,
        confirmationNumber,
      );

    if (!localReservation) {
      logger.info(
        'StayntouchWebhookService: No local reservation for cancel_reservation, skipping',
        { hotelId: hotel.id, externalReservationId, confirmationNumber },
      );
      return {
        success: true,
        message: 'No local reservation found, skipped',
        reservation_id: confirmationNumber,
      };
    }

    // ─── Step 3: Only reservations created via Dextr are in scope ───
    const isDaisyOriginated =
      Object.values<string>(DAISY_SESSION_TYPES).includes(
        localReservation.type,
      ) &&
      localReservation.source === ReservationSource.DIRECT_HOTEL_RESERVATION;

    if (!isDaisyOriginated) {
      logger.info(
        'StayntouchWebhookService: Not a Dextr-originated reservation, skipping',
        { hotelId: hotel.id, externalReservationId, confirmationNumber },
      );
      return {
        success: true,
        message: 'Not a Dextr-originated reservation, skipped',
        reservation_id: confirmationNumber,
      };
    }

    // ─── Step 4: Idempotency — skip if already in terminal status ───
    if (localReservation.status === ReservationStatus.CANCELLED) {
      logger.info(
        'StayntouchWebhookService: Reservation already in terminal status, skipping',
        {
          hotelId: hotel.id,
          externalReservationId,
          confirmationNumber,
          localStatus: localReservation.status,
        },
      );
      return {
        success: true,
        message: `Reservation already ${localReservation.status}, skipped`,
        reservation_id: confirmationNumber,
      };
    }

    // ─── Step 5: Only currently-ACTIVE reservations can be cancelled ───
    if (
      localReservation.status !== ReservationStatus.ACTIVE &&
      localReservation.status !== ReservationStatus.NO_SHOW
    ) {
      logger.info(
        'StayntouchWebhookService: Reservation is not ACTIVE, skipping',
        {
          hotelId: hotel.id,
          externalReservationId,
          confirmationNumber,
          localStatus: localReservation.status,
        },
      );
      return {
        success: true,
        message: `Reservation is ${localReservation.status}, not cancellable, skipped`,
        reservation_id: confirmationNumber,
      };
    }

    // ─── Step 6: Cancel in Dextr via the same flow Dextr itself uses ───
    // CancellationSource.PMS skips the outbound call back to StayNTouch (already
    // the source of truth) and the guest-facing eligibility check, while still
    // running KPI logging and payment-status handling. Refunds are a separate
    // staff-initiated Shift4 flow and are not triggered here.
    const { reservationCancelResult } =
      await this.roomReservationService.cancelReservation(
        localReservation.booking_id,
        CancellationSource.PMS,
        undefined,
        'Cancelled in Stayntouch',
        hotel.id,
      );

    logger.info('StayntouchWebhookService: Reservation cancelled in Dextr', {
      hotelId: hotel.id,
      externalReservationId,
      confirmationNumber,
      reservationId: reservationCancelResult.id,
    });

    return {
      success: true,
      message: 'Reservation status updated to canceled',
      reservation_id: reservationCancelResult.id,
    };
  }

  private async handleCheckinCompleted(
    event: StayntouchEvent,
  ): Promise<WebhookResponse> {
    logger.info(
      `StayntouchWebhookService: Processing checkin_completed for confirmation=${event.data.confirmation_number}, room=${event.data.room_number}`,
    );

    return {
      success: true,
      message: 'Check-in completion not implemented yet',
      reservation_id: event.data.confirmation_number,
    };
  }

  private async handleCheckedout(
    event: StayntouchEvent,
  ): Promise<WebhookResponse> {
    logger.info(
      `StayntouchWebhookService: Processing checkedout for confirmation=${event.data.confirmation_number}`,
    );

    return {
      success: true,
      message: 'Check-out completion not implemented yet',
      reservation_id: event.data.confirmation_number,
    };
  }
}

export const stayntouchWebhookService = new StayntouchWebhookService();
