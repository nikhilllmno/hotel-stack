export interface GetRateResponse {
  id: number;
  code: string;
  name: string;
  hotel_id: number;
  rate_type?: string;
  description?: string;
}
