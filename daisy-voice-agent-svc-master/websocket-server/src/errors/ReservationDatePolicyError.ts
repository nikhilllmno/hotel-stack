import { BaseError } from './BaseError';

/**
 * ReservationDatePolicyError - When the check-in date is beyond the hotel's
 * reservation date policy (e.g. more than 6 months out). Backend does not check
 * availability; guest should contact manager or reservation is not allowed.
 * HTTP Status Code: 400 Bad Request
 */
export class ReservationDatePolicyError extends BaseError {
  constructor(message?: string) {
    if (!message) {
      message =
        'This reservation date is not available for online booking. Please contact the manager.';
    }
    super(message);
    this.statusCode = 400;
    Object.setPrototypeOf(this, ReservationDatePolicyError.prototype);
  }
}
