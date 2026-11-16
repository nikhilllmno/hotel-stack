export interface AvailabilityRequest {
  from_date: string;
  to_date: string;
  adults: number;
  children: number;
  is_channel_manager?: boolean;
}
