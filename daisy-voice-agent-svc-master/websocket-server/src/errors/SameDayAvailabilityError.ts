import { BaseError } from './BaseError';

/**
 * SameDayAvailabilityError - When the backend is not authorized to handle the same day check-in
 * HTTP Status Code: 400 Bad Request
 */
export class SameDayAvailabilityError extends BaseError {
  constructor(message?: string) {
    if (!message) {
      message =
        'Same day availability check is not authorized. Please contact the manager.';
    }
    super(message);
    this.statusCode = 400;

    // This is needed because TypeScript's extending of built-in classes
    Object.setPrototypeOf(this, SameDayAvailabilityError.prototype);
  }
}
