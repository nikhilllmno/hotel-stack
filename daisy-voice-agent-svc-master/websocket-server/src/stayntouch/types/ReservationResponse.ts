export interface CreateReservationResponse {
  id: number;
}

export interface UpdateReservationResponse {
  id: number;
  warnings?: Array<{ message: string }>;
}
