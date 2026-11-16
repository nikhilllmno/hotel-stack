/**
 * Payment Event Handlers
 *
 * Listens to payment events and handles reservation status updates.
 * Keeping this in a separate handler file avoids circular imports between
 * PaymentService and RoomReservationService.
 */

import roomReservationService from '../services/roomReservation/roomReservationService';
import logger from '../utils/logger';
import { paymentEvents, PaymentRefundCompletedEvent } from './paymentEvents';

async function handleRefundCompleted(
  event: PaymentRefundCompletedEvent,
): Promise<void> {
  try {
    logger.debug(
      `handleRefundCompleted: Processing refund completed event for payment ${event.paymentId}`,
    );
    const reservations =
      await roomReservationService.getReservationsByPaymentId(event.paymentId);
    await roomReservationService.updateReservationPaymentStatusFromPaymentInfo(
      reservations,
      'REFUND',
    );
    await roomReservationService.updateResnexusNotesForPaymentUpdate(
      reservations,
    );
    await roomReservationService.updateStayntouchNotesForPaymentUpdate(
      reservations,
    );
    logger.info(
      `handleRefundCompleted: Successfully updated reservation statuses for payment ${event.paymentId}`,
    );
  } catch (error) {
    logger.error(
      `handleRefundCompleted: Failed to update reservation statuses for payment ${event.paymentId}: ${error}`,
    );
  }
}

/**
 * Initialize all payment event listeners.
 * Call this once during application startup.
 */
export function initializePaymentEventHandlers(): void {
  paymentEvents.onRefundCompleted(handleRefundCompleted);
  logger.info('Payment event handlers initialized');
}
