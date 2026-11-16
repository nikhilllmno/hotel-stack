import { PMSQuote } from '../pms/types/Quote';
import { PlatformPricing } from '../types/reservation';

export interface Quote {
  id: string;
  reservation_id: string;
  base_rate: number;
  taxes: number;
  fees: number;
  amount_charged: number;
  /** Platform-adjusted total: base_rate + taxes + fees. */
  total_amount: number;
  quote_object: PMSQuote;
  platform_pricing?: PlatformPricing | null;
  created_at: Date;
  updated_at: Date;
}
