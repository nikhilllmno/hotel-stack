import { HotelConfiguration } from '../../models/HotelConfiguration';

const SENSITIVE_KEYS: (keyof HotelConfiguration)[] = ['twilio_configuration'];

export function stripSensitiveConfigFields(
  config: HotelConfiguration,
): Omit<HotelConfiguration, 'twilio_configuration'> {
  const copy = { ...config } as Record<string, unknown>;
  for (const key of SENSITIVE_KEYS) {
    delete copy[key];
  }
  return copy as Omit<HotelConfiguration, 'twilio_configuration'>;
}

export function stripSensitiveConfigFromReservation<
  T extends { hotel_configuration?: HotelConfiguration | null },
>(reservation: T): T {
  if (!reservation.hotel_configuration) return reservation;
  return {
    ...reservation,
    hotel_configuration: stripSensitiveConfigFields(
      reservation.hotel_configuration,
    ),
  };
}

export function stripSensitiveConfigFromReservations<
  T extends { hotel_configuration?: HotelConfiguration | null },
>(reservations: T[]): T[] {
  return reservations.map(stripSensitiveConfigFromReservation);
}
