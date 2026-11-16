export interface RoomRatesRequest {
  from_date: string;
  to_date: string;
  adults: number;
  children: number;
  rate_id: number;
  room_type_id: number;
}
