export interface ChannelModel {
  id: string;
  hotel_id: string;
  check_in_group_id: string | null;
  alerts_group_id: string | null;
  transcript_group_id: string | null;
  type: string;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date | null;
}
