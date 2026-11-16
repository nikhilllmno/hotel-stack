/**
 * Custom errors for authentication and user management
 */

import { BaseError } from './BaseError';

export class DuplicateUserError extends BaseError {
  constructor(username: string) {
    super(`Username already exists: ${username}`);
    this.statusCode = 409; // HTTP Conflict status code

    // This is needed because TypeScript's extending of built-in classes
    Object.setPrototypeOf(this, DuplicateUserError.prototype);
  }
}

export class InvalidCredentialsError extends BaseError {
  constructor() {
    super('Invalid username or password');
    this.statusCode = 401; // HTTP Unauthorized status code

    Object.setPrototypeOf(this, InvalidCredentialsError.prototype);
  }
}
