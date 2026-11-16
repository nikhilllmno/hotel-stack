import { BaseError } from '../../errors/BaseError';

export class HostawayApiError extends BaseError {
  public statusCode: number;
  public hostawayMessage?: string;

  constructor(
    message: string,
    statusCode: number = 500,
    hostawayMessage?: string,
  ) {
    super(message);
    this.name = 'HostawayApiError';
    this.statusCode = statusCode;
    this.hostawayMessage = hostawayMessage;
  }
}
