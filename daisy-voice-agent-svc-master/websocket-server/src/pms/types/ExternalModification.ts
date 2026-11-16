export type DateModificationScenario =
  | 'same_dates'
  | 'stay_extension'
  | 'stay_reduction'
  | 'non_overlapping';

export type ExternalModificationDateEntry = {
  date: string;
  room_type: string;
  rate_code: string;
  amount: number;
  currency: string;
};

export type ExternalModificationInfo = {
  scenario: DateModificationScenario;
  pricingDelta: number;
  available: boolean;
  rate_id: number;
  rate_code: string;
  room_type_id: number | string;
  adults: number;
  children: number;
  currency: string;
  newDateBreakdown: ExternalModificationDateEntry[];
};
