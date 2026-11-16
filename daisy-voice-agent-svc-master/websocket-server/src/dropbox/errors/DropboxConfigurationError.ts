import { BaseError } from '../../errors/BaseError';

export class DropboxConfigurationError extends BaseError {
  constructor(message: string) {
    super(message);
    this.name = 'DropboxConfigurationError';
    this.statusCode = 500;
    Object.setPrototypeOf(this, DropboxConfigurationError.prototype);
  }
}
