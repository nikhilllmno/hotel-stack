/**
 * PMS-agnostic room info shape returned by `CloudbedsReservationService.getRoomsInfo`.
 * Mirrors the shape returned by the Stayntouch service so callers can swap
 * providers without a translation layer.
 */
export interface CloudbedsRoomInfo {
  room_id: string;
  room_name: string;
  room_code?: string;
  description?: string;
  max_occupancy?: number;
  max_adults?: number;
  max_children?: number;
}
