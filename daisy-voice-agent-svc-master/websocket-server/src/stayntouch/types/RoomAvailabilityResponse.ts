import { CancelRuleInfo, DepositRuleInfo } from './AvailabilityResponse';
import { RoomRatesResponse } from './RoomRatesResponse';

/**
 * Response structure for getRoomAvailabilityWithQuote
 * Contains grouped room availability data with pricing details
 */
export interface RoomAvailabilityWithQuoteResponse {
  groups: RoomGroup[];
  discount: null;
}

/**
 * Individual room group with availability and pricing information
 */
export interface RoomGroup {
  room_id: number;
  room_name: string;
  rate_code: string;
  available_units: number;
  deposit_rule_info: DepositRuleInfo | {};
  cancel_rule_info: CancelRuleInfo | {};
  pricing: RoomRatesResponse;
}
