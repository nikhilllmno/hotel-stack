export interface CreateGuestResponse {
  id: number;
}

export interface GuestWarning {
  message?: string;
}

export interface UpdateGuestResponse {
  id: number;
  warnings?: GuestWarning[];
}
