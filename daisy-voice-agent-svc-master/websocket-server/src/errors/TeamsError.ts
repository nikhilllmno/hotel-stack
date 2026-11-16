import { BaseError } from './BaseError';

/**
 * TeamsError - When a Microsoft Teams (Bot Framework) operation fails
 * HTTP Status Code: 502 Bad Gateway
 */
export class TeamsError extends BaseError {
  constructor(message: string) {
    super(message);
    this.statusCode = 502;

    Object.setPrototypeOf(this, TeamsError.prototype);
  }
}
