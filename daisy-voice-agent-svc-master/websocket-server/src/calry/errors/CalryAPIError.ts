import { BaseError } from '../../errors/BaseError';

export class CalryAPIError extends BaseError {
  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'CalryAPIError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, CalryAPIError.prototype);
  }
}
