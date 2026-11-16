import { BaseError } from '../../errors/BaseError';

export class OperaCardDeclinedError extends BaseError {
  constructor(message: string) {
    super(message);
    this.name = 'OperaCardDeclinedError';
    this.statusCode = 400;
    Object.setPrototypeOf(this, OperaCardDeclinedError.prototype);
  }
}
