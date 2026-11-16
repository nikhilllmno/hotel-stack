import { BaseError } from '../BaseError';

export class NoContextError extends BaseError {
  constructor(message: string) {
    super(
      `Request failed due to: ${message}. The requested data is not available.`,
    );
    this.statusCode = 400; // HTTP Bad Request status code

    Object.setPrototypeOf(this, NoContextError.prototype);
  }
}
