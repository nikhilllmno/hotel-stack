/**
 * Payment Event Emitter
 *
 * Decouples payment refund completion from reservation status updates using events.
 * This avoids circular dependencies between PaymentService and RoomReservationService.
 */

import { EventEmitter } from 'events';
import logger from '../utils/logger';

export interface PaymentRefundCompletedEvent {
  paymentId: string;
}

class PaymentEventEmitter extends EventEmitter {
  emitRefundCompleted(data: PaymentRefundCompletedEvent): void {
    logger.debug(
      `Emitting refund completed event for payment ${data.paymentId}`,
    );
    this.emit('payment:refund:completed', data);
  }

  onRefundCompleted(
    handler: (data: PaymentRefundCompletedEvent) => void | Promise<void>,
  ): void {
    this.on('payment:refund:completed', handler);
  }
}

export const paymentEvents = new PaymentEventEmitter();
