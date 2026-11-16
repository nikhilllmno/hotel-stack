export class StayntouchConfigurationError extends Error {
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = 'StayntouchConfigurationError';
    this.statusCode = 500;
    Object.setPrototypeOf(this, StayntouchConfigurationError.prototype);
  }
}
