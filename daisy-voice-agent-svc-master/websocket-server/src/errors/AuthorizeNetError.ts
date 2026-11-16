import { BaseError } from './BaseError';

/**
 * HTTP Status Code: 402 Payment Required (default)
 * Error thrown when an Authorize.net transaction is declined or the gateway
 * reports a failure. Extends BaseError so the API surfaces an actionable
 * status + message to the frontend instead of a generic 500.
 */
export class AuthorizeNetError extends BaseError {
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'AuthorizeNetError';
    this.statusCode = statusCode ?? 402; // HTTP Payment Required

    // This is needed because TypeScript's extending of built-in classes
    Object.setPrototypeOf(this, AuthorizeNetError.prototype);
  }
}
