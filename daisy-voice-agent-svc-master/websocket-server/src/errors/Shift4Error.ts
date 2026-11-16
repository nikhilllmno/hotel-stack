import { BaseError } from './BaseError';

/**
 * HTTP Status Code: 502 Bad Gateway
 * Error thrown when Shift4 payment processing fails
 */
export class Shift4Error extends BaseError {
  constructor(message: string, statusCode?: number) {
    super(message);
    this.statusCode = statusCode ?? 502; // HTTP Bad Gateway status code

    // This is needed because TypeScript's extending of built-in classes
    Object.setPrototypeOf(this, Shift4Error.prototype);
  }
}
