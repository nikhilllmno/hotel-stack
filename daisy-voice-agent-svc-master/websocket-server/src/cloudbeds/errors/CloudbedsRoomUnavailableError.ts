/**
 * Raised when Cloudbeds availability returns no bookable room types for the
 * requested window (e.g. during single-room booking validation).
 */
export class CloudbedsRoomUnavailableError extends Error {
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = 'CloudbedsRoomUnavailableError';
    this.statusCode = 400;
    Object.setPrototypeOf(this, CloudbedsRoomUnavailableError.prototype);
  }
}
