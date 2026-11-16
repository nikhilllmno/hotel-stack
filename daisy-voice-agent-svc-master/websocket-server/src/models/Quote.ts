import { PMSQuote } from '../pms/types/Quote';
import { PlatformPricing } from '../types/reservation';
import { BaseModel } from './BaseModel';

export interface Quote extends BaseModel {
  reservation_id: string;
  base_rate: number;
  taxes: number;
  fees: number;
  amount_charged: number;
  quote_object: PMSQuote; // The structure will be PMS-dependent
  platform_pricing?: PlatformPricing | null;
}
