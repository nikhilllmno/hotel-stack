import { BaseError } from './BaseError';

/**
 * UnauthorizedError
 * HTTP Status Code: 401 Unauthorized
 */
export class UnauthorizedError extends BaseError {
  constructor(message: string) {
    super(message);
    this.statusCode = 401; // HTTP Unauthorized status code

    // This is needed because TypeScript's extending of built-in classes
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}
