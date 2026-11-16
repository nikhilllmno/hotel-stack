export interface GetQuoteRequestParams {
  business_id: number;
  unit_group_id: number;
  check_in: string;
  check_out: string;
  num_adults: number;
  num_children?: number;
}
