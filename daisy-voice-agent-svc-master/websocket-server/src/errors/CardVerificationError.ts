import { BaseError } from './BaseError';

export class CardVerificationError extends BaseError {
  constructor() {
    super(
      'We could not verify this card. Please check the details or try another card.',
    );
    this.statusCode = 400;
    Object.setPrototypeOf(this, CardVerificationError.prototype);
  }
}
