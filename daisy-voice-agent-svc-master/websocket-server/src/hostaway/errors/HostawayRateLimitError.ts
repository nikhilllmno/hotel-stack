import { BaseError } from '../../errors/BaseError';

export class HostawayRateLimitError extends BaseError {
  public statusCode: number;
  public retryAfter?: number;

  constructor(
    message: string = 'Hostaway API rate limit exceeded',
    retryAfter?: number,
  ) {
    super(message);
    this.name = 'HostawayRateLimitError';
    this.statusCode = 429;
    this.retryAfter = retryAfter;
  }
}
