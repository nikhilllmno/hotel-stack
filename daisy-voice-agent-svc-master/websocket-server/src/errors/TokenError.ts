import { BaseError } from './BaseError';

/**
 * TokenError - When a token-related error occurs
 * HTTP Status Code: 400 Bad Request
 */
export class TokenError extends BaseError {
  constructor(message: string) {
    super(message);
    this.statusCode = 400; // HTTP Bad Request status code
    Object.setPrototypeOf(this, TokenError.prototype);
  }
}
