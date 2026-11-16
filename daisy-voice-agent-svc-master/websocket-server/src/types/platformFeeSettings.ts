import { PlatformFeeType } from './platformFee';

export interface PlatformFeeSettings {
  active: boolean;
  value: number;
  type: PlatformFeeType;
}
