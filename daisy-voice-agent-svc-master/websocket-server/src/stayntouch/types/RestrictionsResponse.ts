export interface RestrictionDateRange {
  from_date: string;
  to_date: string;
}

export interface NumericRestrictionEntry {
  value: number;
  date_ranges: RestrictionDateRange[];
}

export interface BooleanRestrictionEntry {
  value: boolean;
  date_ranges: RestrictionDateRange[];
}

export interface RoomTypeRestriction {
  room_type_id: number;
  closed: BooleanRestrictionEntry[];
  closed_arrival: BooleanRestrictionEntry[];
  closed_departure: BooleanRestrictionEntry[];
  min_stay_through: NumericRestrictionEntry[];
  min_length_of_stay: NumericRestrictionEntry[];
  max_length_of_stay: NumericRestrictionEntry[];
  min_advanced_booking: NumericRestrictionEntry[];
  max_advanced_booking: NumericRestrictionEntry[];
}

export interface RestrictionsResponse {
  restrictions: RoomTypeRestriction[];
}

export interface GetRestrictionsParams {
  hotel_id: string | number;
  from_date: string;
  to_date: string;
}
