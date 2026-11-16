import { BaseError } from '../../errors/BaseError';

export class MewsRestrictedError extends BaseError {
  constructor(message: string) {
    super(message);
    this.name = 'MewsRestrictedError';
    this.statusCode = 400;
    Object.setPrototypeOf(this, MewsRestrictedError.prototype);
  }
}
