import { BaseError } from '../../errors/BaseError';

export class RemoteLockAPIError extends BaseError {
  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.name = 'RemoteLockAPIError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, RemoteLockAPIError.prototype);
  }
}
