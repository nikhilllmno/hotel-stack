import { BaseError } from './BaseError';

/**
 * SlackError - When a Slack API / incoming-webhook operation fails.
 * HTTP Status Code: 502 Bad Gateway
 */
export class SlackError extends BaseError {
  constructor(message: string) {
    super(message);
    this.statusCode = 502; // HTTP Bad Gateway status code

    // This is needed because TypeScript's extending of built-in classes
    Object.setPrototypeOf(this, SlackError.prototype);
  }
}
