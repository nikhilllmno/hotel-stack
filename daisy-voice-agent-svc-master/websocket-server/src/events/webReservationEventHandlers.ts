import { SessionType } from '../dtos/enum/SessionType';
import { StatusUpdateType } from '../models/request/StatusUpdate';
import roomReservationService from '../services/roomReservation/roomReservationService';
import sessionService from '../services/session/SessionService';
import logger from '../utils/logger';
import {
  WebReservationCreatedEvent,
  webReservationEvents,
} from './webReservationEvents';

export function initializeWebReservationEventHandlers(): void {
  webReservationEvents.onWebReservationCreated(
    async (event: WebReservationCreatedEvent) => {
      try {
        const { session } = await sessionService.createSession({
          caller_phone_number: event.customerPhone,
          assistant_phone_number: event.assistantPhone,
          session_type: SessionType.WEB,
          session_status: StatusUpdateType.Ended, // web reservations are ended as soon as they are created
        });

        // Attach the session id to all reservations using RoomReservationService
        await roomReservationService.linkSessionToReservations(
          event.reservationIds,
          session.id,
        );

        logger.info(
          `onWebReservationCreated: Web reservation session created for reservation ${JSON.stringify(event.reservationIds)}, session id: ${session.id}`,
        );
      } catch (error) {
        logger.error(
          `onWebReservationCreated: Failed to create session for web reservation ${JSON.stringify(event.reservationIds)}: ${error}`,
        );
      }
    },
  );
}
