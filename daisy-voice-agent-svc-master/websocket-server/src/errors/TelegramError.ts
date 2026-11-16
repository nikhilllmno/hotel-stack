import { BaseError } from './BaseError';

/**
 * TelegramError - When a Telegram API operation fails
 * HTTP Status Code: 502 Bad Gateway
 */
export class TelegramError extends BaseError {
  constructor(message: string) {
    super(message);
    this.statusCode = 502; // HTTP Bad Gateway status code

    // This is needed because TypeScript's extending of built-in classes
    Object.setPrototypeOf(this, TelegramError.prototype);
  }
}
