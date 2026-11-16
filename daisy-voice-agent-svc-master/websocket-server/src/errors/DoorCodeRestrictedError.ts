import { BaseError } from './BaseError';

/**
 * DoorCodeRestrictedError - When a door code is withheld because the
 * matching reservation isn't yet eligible (e.g. not fully paid).
 * HTTP Status Code: 403 Forbidden
 */
export class DoorCodeRestrictedError extends BaseError {
  constructor(message: string) {
    super(message);
    this.statusCode = 403;
    Object.setPrototypeOf(this, DoorCodeRestrictedError.prototype);
  }
}
