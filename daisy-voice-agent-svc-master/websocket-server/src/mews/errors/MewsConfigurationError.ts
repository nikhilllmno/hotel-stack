import { BaseError } from '../../errors/BaseError';

export class MewsConfigurationError extends BaseError {
  constructor(message: string) {
    super(message);
    this.name = 'MewsConfigurationError';
    this.statusCode = 500;
    Object.setPrototypeOf(this, MewsConfigurationError.prototype);
  }
}
