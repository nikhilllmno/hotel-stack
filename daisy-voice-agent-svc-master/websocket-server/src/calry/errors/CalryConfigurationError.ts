import { BaseError } from '../../errors/BaseError';

export class CalryConfigurationError extends BaseError {
  constructor(message: string) {
    super(message);
    this.name = 'CalryConfigurationError';
    this.statusCode = 500;
    Object.setPrototypeOf(this, CalryConfigurationError.prototype);
  }
}
