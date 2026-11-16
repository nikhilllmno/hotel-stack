import { BaseError } from '../../errors/BaseError';

export class DropboxAPIError extends BaseError {
  constructor(message: string, statusCode: number = 502) {
    super(message);
    this.name = 'DropboxAPIError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, DropboxAPIError.prototype);
  }
}
