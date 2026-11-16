/**
 * Raised when the Cloudbeds API returns an error response, whether at the
 * HTTP layer (non-2xx status) or at the envelope layer (`success: false`).
 *
 * Wraps the upstream message and HTTP status so callers can surface a
 * user-friendly error without inspecting raw axios errors.
 */
export class CloudbedsAPIError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.name = 'CloudbedsAPIError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, CloudbedsAPIError.prototype);
  }
}
