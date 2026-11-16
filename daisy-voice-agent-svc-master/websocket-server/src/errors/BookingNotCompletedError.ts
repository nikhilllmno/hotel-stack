import { BaseError } from './BaseError';

export class BookingNotCompletedError extends BaseError {
  constructor(audience: 'assistant' | 'guest') {
    super(
      audience === 'assistant'
        ? 'This booking could not be completed. Escalate to the hotel.'
        : "We couldn't complete this booking. Please contact the hotel directly.",
    );
    this.statusCode = 400;
    Object.setPrototypeOf(this, BookingNotCompletedError.prototype);
  }
}
