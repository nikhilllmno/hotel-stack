export interface GetResNexusAvailabilityRequestParams {
  start_date: string;
  end_date: string;
  business_id: number;
}

export interface GetResNexusSingleRoomAvailabilityRequestParams extends GetResNexusAvailabilityRequestParams {
  num_adults: number;
  num_children?: number;
}

export interface GetResNexusAvailabilityByUnitGroupRequestParams extends GetResNexusAvailabilityRequestParams {
  unit_group_id: number;
}
