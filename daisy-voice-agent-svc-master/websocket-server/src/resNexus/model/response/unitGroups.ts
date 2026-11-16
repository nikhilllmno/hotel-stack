export interface GetUnitGroupsResponse {
  business_id: number;
  unit_groups: UnitGroup[];
  response_errors: string[];
}

export interface UnitGroup {
  unit_group_id: number;
  business_id: number;
  name: string;
  unit_ids: number[];
  number_of_units: number;
  description: string;
  per_unit_capacity: number;
  max_children: number;
  unit_type: string;
}

export interface ExtendedUnitGroup extends UnitGroup {
  room_name: string;
  unit_group_name: string;
  max_capacity: number;
  max_capacity_text: string;
  room_id: number;
}

export interface GetRoomsInfoResponse {
  business_id: number;
  response_errors: string[];
  note: string;
  unit_groups: ExtendedUnitGroup[];
}
