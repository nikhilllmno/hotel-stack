import { BaseError } from './BaseError';

export class PmsBookingOutcomeUnknownError extends BaseError {
  constructor() {
    super(
      "We couldn't confirm your booking with the hotel. Please don't submit your card again; the hotel will contact you to confirm it.",
    );
    this.statusCode = 502;
    Object.setPrototypeOf(this, PmsBookingOutcomeUnknownError.prototype);
  }
}
