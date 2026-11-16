import { BaseError } from '../../errors/BaseError';

export class MewsRoomUnavailableError extends BaseError {
  constructor(message: string) {
    super(message);
    this.name = 'MewsRoomUnavailableError';
    this.statusCode = 400;
    Object.setPrototypeOf(this, MewsRoomUnavailableError.prototype);
  }
}
