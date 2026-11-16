import { GetReservationResponse } from '../types/GetReservationResponse';

/**
 * Stayntouch's getReservation API may include departure_date as an extra entry
 * in stay_dates (often last, but ordering is not guaranteed). Remove any
 * matching entry so stay_dates represent occupied nights only.
 */
export function stripCheckoutDateFromStayDates<T extends { date: string }>(
  stayDates: T[] | undefined,
  departureDate: string | undefined,
): T[] | undefined {
  if (!stayDates?.length || !departureDate) {
    return stayDates;
  }

  const withoutCheckout = stayDates.filter(
    (stayDate) => stayDate.date !== departureDate,
  );
  if (withoutCheckout.length === stayDates.length) {
    return stayDates;
  }

  return withoutCheckout;
}

/** Normalizes stay_dates on a getReservation response before use downstream. */
export function normalizeGetReservationStayDates(
  reservation: GetReservationResponse,
): GetReservationResponse {
  const normalizedStayDates = stripCheckoutDateFromStayDates(
    reservation.stay_dates,
    reservation.departure_date,
  );

  if (normalizedStayDates === reservation.stay_dates) {
    return reservation;
  }

  return {
    ...reservation,
    stay_dates: normalizedStayDates,
  };
}
