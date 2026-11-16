import { BaseError } from '../../errors/BaseError';

export class RemoteLockConfigurationError extends BaseError {
  constructor(message: string) {
    super(message);
    this.name = 'RemoteLockConfigurationError';
    this.statusCode = 500;
    Object.setPrototypeOf(this, RemoteLockConfigurationError.prototype);
  }
}
