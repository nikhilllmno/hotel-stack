import { BaseError } from '../BaseError';

class ResNexusError extends BaseError {
  public response_errors: string[];
  private errorMap: Record<string, string> = {
    'No groups are available':
      'Room not available for the given dates and number of guests',
    'Children not allowed at property': 'Children not allowed at property',
    'Internal Error': 'Internal Server Error',
  };
  constructor(response_errors: string[]) {
    super('Request failed due to error(s): ' + response_errors.join(', '));
    this.name = 'ResNexusError';
    this.response_errors = response_errors;
    this.statusCode = 400;
    // This is needed because TypeScript's extending of built-in classes
    Object.setPrototypeOf(this, ResNexusError.prototype);
  }

  public toJSON() {
    const errorMsgs = this.getResponseErrors();
    return {
      message: errorMsgs.join(', ') || 'Internal Server Error',
      statusCode: this.statusCode,
    };
  }

  protected getResponseErrors() {
    return this.response_errors
      .map((error) => this.errorMap[error] || undefined)
      .filter((error) => error !== undefined);
  }
}

export default ResNexusError;
