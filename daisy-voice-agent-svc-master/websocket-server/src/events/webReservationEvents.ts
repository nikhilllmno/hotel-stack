import { EventEmitter } from 'events';
import { SessionType } from '../dtos/enum/SessionType';

export interface WebReservationCreatedEvent {
  reservationIds: string[];
  customerPhone: string;
  assistantPhone: string;
  businessId: string;
  sessionType: SessionType;
}

class WebReservationEventEmitter extends EventEmitter {
  emitWebReservationCreated(data: WebReservationCreatedEvent): void {
    this.emit('webReservation:created', data);
  }

  onWebReservationCreated(
    handler: (data: WebReservationCreatedEvent) => void | Promise<void>,
  ): void {
    this.on('webReservation:created', handler);
  }
}

export const webReservationEvents = new WebReservationEventEmitter();
