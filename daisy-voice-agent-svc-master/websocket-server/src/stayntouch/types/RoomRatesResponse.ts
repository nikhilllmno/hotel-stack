export interface StayDate {
  date: string;
  rate_amount: number;
  addon_amount: number;
  exclusive_tax: number;
  exclusive_tourist_tax: number;
  inclusive_tax: number;
  total_amount: number;
}

export interface RoomRatesResponse {
  total_stay_cost: number;
  total_inclusive_tax: number;
  total_exclusive_tax: number;
  total_exclusive_tourist_tax: number;
  stay_dates: StayDate[];
  amountCharged?: number;
}
