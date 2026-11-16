export interface PmsProviderDTO {
  id: string;
  name: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreatePmsProviderDTO {
  name: string;
  is_active?: boolean;
}

export interface UpdatePmsProviderDTO {
  name?: string;
  is_active?: boolean;
}
