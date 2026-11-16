import { BaseError } from './BaseError';

/**
 * AlfredError - When an Alfred API call fails
 * HTTP Status Code: Varies based on Alfred response
 */
export class AlfredError extends BaseError {
  constructor(message: string, statusCode: number = 502) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, AlfredError.prototype);
  }
}
