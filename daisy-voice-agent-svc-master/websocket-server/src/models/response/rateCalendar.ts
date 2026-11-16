export interface RateCalendarUnit {
  id: string;
  name: string;
  max_guests: number | null;
}

export interface RateCalendarRate {
  unit_id: string;
  /** Nightly rate before taxes and fees; null when the PMS returned no price for that night. */
  price: number | null;
  available: boolean;
  min_stay: number | null;
}

export interface RateCalendarNight {
  /** The night of the stay, YYYY-MM-DD (check-in date for a one-night stay). */
  date: string;
  rates: RateCalendarRate[];
}

/** What a PMS service returns; the hotel-level fields are added by RoomReservationService. */
export interface RateCalendar {
  /** ISO 4217 currency code, e.g. "USD". */
  currency: string;
  units: RateCalendarUnit[];
  nights: RateCalendarNight[];
}

export interface RateCalendarResponse extends RateCalendar {
  hotel_name: string;
  /** The hotel's public guest line (the number its Dextr agent answers). */
  hotel_phone: string | null;
  hotel_website: string | null;
  start_date: string;
  end_date: string;
}
