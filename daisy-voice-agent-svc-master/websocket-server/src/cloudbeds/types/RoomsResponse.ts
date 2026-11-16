/**
 * `GET /getRooms?propertyIDs=<id>` response shapes.
 *
 * Cloudbeds groups physical rooms under a property in the outer array, with
 * each room type expanded inside the `rooms` array.
 */

export interface CloudbedsRoom {
  roomID: string;
  roomName: string;
  roomDescription?: string;
  maxGuests?: number;
  isPrivate?: boolean;
  roomBlocked?: boolean;
  roomTypeID: string;
  roomTypeName: string;
  roomTypeNameShort?: string;
}

export interface CloudbedsPropertyRooms {
  propertyID: string;
  rooms: CloudbedsRoom[];
}

export type CloudbedsRoomsResponseData = CloudbedsPropertyRooms[];
