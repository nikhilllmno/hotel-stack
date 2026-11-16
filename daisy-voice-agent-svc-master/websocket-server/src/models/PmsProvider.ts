import { BaseModel } from './BaseModel';

export interface PmsProviderModel extends BaseModel {
  id: string;
  name: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}
