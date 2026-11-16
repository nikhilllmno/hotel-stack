export interface RoomTypeIdCount {
  id: string;
  count: number;
}

export interface RoomTypeDetails {
  id: number;
  code: string;
  name: string;
  description: string;
  max_occupancy: number | null;
  image_url: string | null;
  image_urls: string[];
  suite: boolean;
  pseudo: boolean;
  room_type_ids?: RoomTypeIdCount[];
}

export interface RoomTypesResponse {
  results: RoomTypeDetails[];
  total_count: number;
}
