import logger from '../utils/logger';

export class BaseError extends Error {
  statusCode: number;
  message: string;

  constructor(message: string) {
    super(message);
    this.name = 'BaseError';
    this.statusCode = 400; // HTTP Bad Request status code
    this.message = message;

    // Log error for AWS/CloudWatch
    logger.error(`Error: ${this.message}`);

    // This is needed because TypeScript's extending of built-in classes
    Object.setPrototypeOf(this, BaseError.prototype);
  }

  public toJSON() {
    return {
      message: this.message,
      statusCode: this.statusCode,
    };
  }
}
