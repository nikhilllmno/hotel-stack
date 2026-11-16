import { BaseError } from './BaseError';

/**
 * ExternalAPIError - When an external API call fails
 * HTTP Status Code: 502 Bad Gateway
 */
export class ExternalAPIError extends BaseError {
  constructor(message: string) {
    super(message);
    this.statusCode = 502; // HTTP Bad Gateway status code

    // This is needed because TypeScript's extending of built-in classes
    Object.setPrototypeOf(this, ExternalAPIError.prototype);
  }
}
