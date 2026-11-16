export interface DepositRuleInfo {
  id: number;
  name: string;
  description: string;
}

export interface CancelRuleInfo {
  id: number;
  name: string;
  description: string;
}

export interface RoomType {
  id: number;
  name: string;
  availability: number;
  adr: number;
}

export interface RateResult {
  rate_id: number;
  rate_code: string;
  deposit_rule_info: DepositRuleInfo | {};
  cancel_rule_info: CancelRuleInfo | {};
  room_types: RoomType[];
}

export interface AvailabilityResponse {
  results: RateResult[];
  total_count: number;
}
