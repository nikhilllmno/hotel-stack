export class StayntouchRoomUnavailableError extends Error {
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = 'StayntouchRoomUnavailableError';
    this.statusCode = 400;
    Object.setPrototypeOf(this, StayntouchRoomUnavailableError.prototype);
  }
}
