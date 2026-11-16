import { BaseError } from '../../errors/BaseError';

export class HostawayAuthenticationError extends BaseError {
  public statusCode: number;

  constructor(
    message: string = 'Hostaway authentication failed. Invalid access token.',
  ) {
    super(message);
    this.name = 'HostawayAuthenticationError';
    this.statusCode = 401;
  }
}
