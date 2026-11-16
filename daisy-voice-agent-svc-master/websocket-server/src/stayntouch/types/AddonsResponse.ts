export interface Addon {
  id: number;
  name: string;
  description: string;
  amount: number;
  amount_type: 'ADULT' | 'CHILD' | 'FLAT' | 'PERSON' | 'ROOM';
  post_type: 'STAY' | 'WEEKLY' | 'NIGHT' | 'LAST_NIGHT';
  post_type_description:
    | 'Nightly'
    | 'Every Week'
    | 'FirstNight'
    | 'Post on Last Night';
  post_days?: string[]; // List of weekdays (order according to ISO-8601 standard). Only returned when Post Type is STAY.
  charge_code_id: number;
  charge_group_id: number;
  image_url?: string;
  currency_code: string; // Associated Currency Code (ISO 4217 Format)
  online: boolean; // Indicates if the addon is available for public sale online (e.g., IBE).
}

export interface AddonsResponse {
  results: Addon[];
  total_count?: number;
}
