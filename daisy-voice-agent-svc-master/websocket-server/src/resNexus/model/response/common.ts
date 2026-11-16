export interface RateForDateList {
  ResDate: string;
  Rate: number;
}

export interface Customer {
  first_name: string;
  last_name: string;
  phone_number: string;
  email: string;
  address: Address;
}

export interface Address {
  state_or_province: string;
  postal_code: string;
}
