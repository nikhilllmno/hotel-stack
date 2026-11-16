export interface Customer {
  first_name: string;
  address?: Address;
  last_name: string;
  phone_number: string;
  email?: string;
}

/** `city` and `country` are sent because ResNexus runs AVS against them when a card is attached. */
export interface Address {
  address_line?: string;
  city?: string;
  state_or_province?: string;
  postal_code?: string;
  country?: string;
}

export interface CardFields {
  card_name?: string;
  card_number: string;
  card_cvv: string;
  expire_month: number;
  expire_year: number;
}
