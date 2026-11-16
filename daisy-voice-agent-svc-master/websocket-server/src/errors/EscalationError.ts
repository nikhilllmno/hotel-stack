import { BaseError } from './BaseError';

/**
 * EscalationError - When an escalation operation fails
 * HTTP Status Code: 500 Internal Server Error
 */
export class EscalationError extends BaseError {
  constructor(message: string) {
    super(message);
    this.statusCode = 400; // HTTP Internal Server Error status code

    // This is needed because TypeScript's extending of built-in classes
    Object.setPrototypeOf(this, EscalationError.prototype);
  }
}
