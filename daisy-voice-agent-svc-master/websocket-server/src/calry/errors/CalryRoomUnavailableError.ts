import { BaseError } from '../../errors/BaseError';

export class CalryRoomUnavailableError extends BaseError {
  constructor(message: string) {
    super(message);
    this.name = 'CalryRoomUnavailableError';
    this.statusCode = 400;
    Object.setPrototypeOf(this, CalryRoomUnavailableError.prototype);
  }
}
