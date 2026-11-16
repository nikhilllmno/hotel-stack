import { BaseError } from './BaseError';

export class DuplicateDiscountError extends BaseError {
  constructor(phoneNumber: string) {
    super(`Discount already exists for phone number: ${phoneNumber}`);
    this.statusCode = 409; // HTTP Conflict status code

    // This is needed because TypeScript's extending of built-in classes
    Object.setPrototypeOf(this, DuplicateDiscountError.prototype);
  }
}
