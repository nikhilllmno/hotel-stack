import { BaseError } from './BaseError';

/**
 * HTTP Status Code: 502 Bad Gateway
 * Error thrown when a Shift4 communication failure occurs and the transaction
 * status cannot be determined after invoice lookup retries.
 * These transactions should be logged for auditor review.
 * Ref: https://docs.shift4.com/guides/response-handling/timeouts-and-communications-failures
 */
export class Shift4CommunicationError extends BaseError {
  invoice: string;

  constructor(invoice: string, message: string) {
    super(`Shift4 communication error for invoice ${invoice}: ${message}`);
    this.statusCode = 502;
    this.invoice = invoice;

    Object.setPrototypeOf(this, Shift4CommunicationError.prototype);
  }
}
