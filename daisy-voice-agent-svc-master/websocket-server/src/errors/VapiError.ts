import { BaseError } from './BaseError';

/**
 * VapiError - For invalid request parameters or missing required fields
 * HTTP Status Code: 400 Bad Request
 */
export class VapiError extends BaseError {
  constructor(message: string) {
    super(message);
    this.statusCode = 400; // HTTP Bad Request status code

    // This is needed because TypeScript's extending of built-in classes
    Object.setPrototypeOf(this, VapiError.prototype);
  }
}
