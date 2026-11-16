import { BaseError } from './BaseError';

export class NoDataError extends BaseError {
  constructor(message: string) {
    super(message);
    this.statusCode = 404; // HTTP Unauthorized status code

    Object.setPrototypeOf(this, NoDataError.prototype);
  }
}
