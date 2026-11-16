import { BaseError } from '../../errors/BaseError';

export class CalryIntegrationDisabledError extends BaseError {
  constructor(message: string) {
    super(message);
    this.name = 'CalryIntegrationDisabledError';
    this.statusCode = 503;
    Object.setPrototypeOf(this, CalryIntegrationDisabledError.prototype);
  }
}
