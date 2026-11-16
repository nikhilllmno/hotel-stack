/**
 * Maps a Calry reservation onto the PMS-agnostic reservation DTO.
 *
 * Two Calry quirks drive the shape of this file:
 * - Guest fields are asymmetric. Writes take `guest.firstName` etc.; reads
 *   return `primaryGuest.nameFirst`, `emails[]`, `mobileNumbers[]` and
 *   `addresses.postal_code`.
 * - `status` and `source` are case-inconsistent upstream (`CONFIRMED`,
 *   `confirmed`, `new`, `DIRECT`, `direct`), so both are normalised.
 */

import { Customer } from '../../dtos/Customer';
import { ReservationSource } from '../../dtos/enum/ReservationSource';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { SessionType } from '../../dtos/enum/SessionType';
import { Hotel as HotelDTO } from '../../dtos/Hotel';
import { HotelConfiguration } from '../../dtos/HotelConfiguration';
import { Reservation as ReservationDTO } from '../../dtos/Reservation';
import { Hotel } from '../../models/Hotel';
import { PmsProvider } from '../../types/enums';
import { CalryReservation } from '../types';

export function mapCalryReservationToDTO(
  reservation: CalryReservation,
  hotel: Hotel,
  hotelConfiguration: HotelConfiguration | null,
): ReservationDTO {
  const roomTypeId = reservation.roomTypeIds?.[0] ?? '';
  const phoneNumber =
    reservation.primaryGuest?.mobileNumbers?.[0]?.trim() ?? '';

  return {
    id: reservation.id,
    booking_id: reservation.id,
    external_id: reservation.id,
    external_public_id: reservation.id,
    phone_number: phoneNumber,
    type: SessionType.EXTERNAL,
    room_id: roomTypeId,
    room_type: roomTypeId,
    business_id: String(hotel.business_id),
    hotel_id: hotel.id,
    pms_provider: PmsProvider.CALRY,
    status: mapCalryStatus(reservation.status),
    check_in: parseRequiredDate(reservation.arrivalDate, 'arrivalDate'),
    check_out: parseRequiredDate(reservation.departureDate, 'departureDate'),
    num_adults: reservation.numberOfAdults ?? reservation.numberOfGuests ?? 0,
    num_children: reservation.numberOfChildren ?? 0,
    num_pets: reservation.numberOfPets ?? 0,
    created_at: parseDateSafe(reservation.createdAt),
    updated_at: parseDateSafe(reservation.updatedAt),
    notes_from_partner: reservation.notes ?? undefined,
    // Calry cannot bind a reservation to a rate plan, so there is no rate
    // identity to carry back from the PMS.
    rate_code: null,
    rate_id: null,
    customer: mapGuestToCustomer(reservation, hotel.id, phoneNumber),
    hotel: mapHotelToDto(hotel),
    hotel_configuration: hotelConfiguration,
    channel: null,
    payments: null,
    quote: null,
    discount: null,
    reservation_source: mapCalryReservationSource(reservation.source),
  };
}

function mapGuestToCustomer(
  reservation: CalryReservation,
  hotelId: string,
  phoneNumber: string,
): Customer {
  const guest = reservation.primaryGuest;
  if (!guest) {
    return { phone_number: phoneNumber, hotel_id: hotelId };
  }

  const address = guest.addresses;
  const hasAddress = !!(
    address?.line1 ||
    address?.city ||
    address?.state ||
    address?.country ||
    address?.postal_code
  );

  return {
    phone_number: guest.mobileNumbers?.[0]?.trim() || phoneNumber,
    hotel_id: hotelId,
    first_name: guest.nameFirst,
    last_name: guest.nameLast,
    email: guest.emails?.[0],
    address: hasAddress
      ? {
          address_first_line: address?.line1,
          city: address?.city,
          state_or_province: address?.state,
          postal_code: address?.postal_code,
          country: address?.country,
        }
      : null,
    billing_address: null,
  };
}

function mapHotelToDto(hotel: Hotel): HotelDTO {
  return {
    id: hotel.id,
    name: hotel.name,
    business_id: String(hotel.business_id),
    pms_provider: hotel.pms_provider,
    payment_provider: hotel.payment_provider,
    telegram_check_in_group_id: hotel.telegram_check_in_group_id,
    telegram_alerts_group_id: hotel.telegram_alerts_group_id,
    telegram_transcript_group_id: hotel.telegram_transcript_group_id,
    notification_type: hotel.notification_type,
    timezone: hotel.timezone,
    created_at: hotel.created_at,
    updated_at: hotel.updated_at,
    assistant_phone_number: hotel.assistant_phone_number,
    country: hotel.country,
    sms_number: hotel.sms_number,
    internal_phone_number: hotel.internal_phone_number,
    address: hotel.address,
    image_url: hotel.image_url,
    currency: hotel.currency,
    url: hotel.url,
  };
}

/**
 * Calry publishes no canonical status enum; these are the values observed
 * across its docs. Anything unrecognised is treated as INACTIVE so an
 * unexpected value never reads as a live booking.
 */
function mapCalryStatus(status: string | undefined): ReservationStatus {
  switch (status?.toLowerCase()) {
    case 'cancelled':
    case 'canceled':
      return ReservationStatus.CANCELLED;
    case 'no_show':
      return ReservationStatus.NO_SHOW;
    case 'confirmed':
    case 'checked_in':
    case 'checked_out':
      return ReservationStatus.ACTIVE;
    default:
      return ReservationStatus.INACTIVE;
  }
}

function mapCalryReservationSource(
  source: string | undefined,
): ReservationSource {
  const normalized = (source ?? '').toLowerCase();
  if (normalized.includes('direct') || normalized.includes('website')) {
    return ReservationSource.DIRECT_HOTEL_RESERVATION;
  }
  return ReservationSource.THIRD_PARTY_RESERVATION;
}

function parseDateSafe(value: string | undefined | null): Date | undefined {
  if (!value?.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseRequiredDate(
  value: string | undefined,
  fieldLabel: string,
): Date {
  const parsed = parseDateSafe(value);
  if (!parsed) {
    throw new Error(
      `mapCalryReservationToDTO: Invalid ${fieldLabel}: ${value ?? 'missing'}`,
    );
  }
  return parsed;
}
