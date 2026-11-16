import { BaseError } from '../../errors/BaseError';

export class MewsPastStartUtcError extends BaseError {
  constructor(message: string) {
    super(message);
    this.name = 'MewsPastStartUtcError';
    this.statusCode = 400;
    Object.setPrototypeOf(this, MewsPastStartUtcError.prototype);
  }
}
