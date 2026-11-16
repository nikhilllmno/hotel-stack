export class StayntouchAPIError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.name = 'StayntouchAPIError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, StayntouchAPIError.prototype);
  }
}
