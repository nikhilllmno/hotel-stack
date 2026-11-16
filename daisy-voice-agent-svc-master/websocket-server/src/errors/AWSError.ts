import { BaseError } from './BaseError';

/**
 * AWSError - When an AWS service operation fails
 * HTTP Status Code: 500 Internal Server Error
 */
export class AWSError extends BaseError {
  constructor(message: string) {
    super(message);
    this.statusCode = 500; // HTTP Internal Server Error status code

    // This is needed because TypeScript's extending of built-in classes
    Object.setPrototypeOf(this, AWSError.prototype);
  }
}
