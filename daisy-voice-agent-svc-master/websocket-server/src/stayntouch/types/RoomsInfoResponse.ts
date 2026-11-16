import { RoomTypeIdCount } from './RoomTypesResponse';

export interface StayntouchRoomInfo {
  room_id: number;
  room_name: string;
  room_code: string;
  description: string;
  max_occupancy: number | null;
  image_url: string | null;
  image_urls: string[];
  suite: boolean;
  pseudo: boolean;
  room_type_ids?: RoomTypeIdCount[];
}
