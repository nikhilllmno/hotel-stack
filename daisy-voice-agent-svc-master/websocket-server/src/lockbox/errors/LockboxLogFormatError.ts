import { BaseError } from '../../errors/BaseError';

/**
 * The lockbox log could not be read as the expected workbook. Messages name
 * the sheet or header that is wrong, never a cell's contents, since a shifted
 * layout can put a guest's name where a header was expected.
 */
export class LockboxLogFormatError extends BaseError {
  constructor(message: string) {
    super(message);
    this.name = 'LockboxLogFormatError';
    this.statusCode = 500;
    Object.setPrototypeOf(this, LockboxLogFormatError.prototype);
  }
}
