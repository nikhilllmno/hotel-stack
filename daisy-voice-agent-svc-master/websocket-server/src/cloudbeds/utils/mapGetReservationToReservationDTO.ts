import { Customer } from '../../dtos/Customer';
import { Hotel as HotelDTO } from '../../dtos/Hotel';
import { HotelConfiguration } from '../../dtos/HotelConfiguration';
import { Reservation as ReservationDTO } from '../../dtos/Reservation';
import { ReservationSource } from '../../dtos/enum/ReservationSource';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { SessionType } from '../../dtos/enum/SessionType';
import { Hotel } from '../../models/Hotel';
import { PmsProvider } from '../../types/enums';
import {
  CloudbedsGetReservationGuestEntry,
  CloudbedsGetReservationResponseData,
} from '../types/GetReservationResponse';
import { extractRoomNumber } from './extractRoomNumber';

export function mapCloudbedsGetReservationToReservationDTO(
  reservation: CloudbedsGetReservationResponseData,
  hotel: Hotel,
  hotelConfiguration: HotelConfiguration | null,
): ReservationDTO {
  const mainGuest = findMainGuest(reservation.guestList);
  const roomAssignment =
    reservation.assigned?.[0] ?? reservation.unassigned?.[0];
  const roomTypeId = parseIntSafe(
    roomAssignment?.roomTypeID ?? mainGuest?.roomTypeID,
  );
  const phoneNumber =
    mainGuest?.guestCellPhone?.trim() || mainGuest?.guestPhone?.trim() || '';

  const hotelDto = mapHotelToDto(hotel);

  return {
    id: reservation.reservationID,
    booking_id: reservation.reservationID,
    external_id: reservation.reservationID,
    external_public_id: reservation.reservationID,
    phone_number: phoneNumber,
    type: SessionType.EXTERNAL,
    room_id: roomTypeId,
    room_type:
      roomAssignment?.roomTypeName ??
      mainGuest?.roomTypeName ??
      String(roomTypeId),
    room_name: roomAssignment?.roomName ?? mainGuest?.roomName ?? null,
    room_number: extractRoomNumber(
      roomAssignment?.roomName ?? mainGuest?.roomName,
    ),
    business_id: String(hotel.business_id),
    hotel_id: hotel.id,
    pms_provider: PmsProvider.CLOUDBEDS,
    status: mapCloudbedsStatus(reservation.status),
    check_in: parseRequiredDate(reservation.startDate, 'startDate'),
    check_out: parseRequiredDate(reservation.endDate, 'endDate'),
    num_adults: parseIntSafe(roomAssignment?.adults),
    num_children: parseIntSafe(roomAssignment?.children),
    created_at: parseDateSafe(reservation.dateCreated),
    updated_at: parseDateSafe(reservation.dateModified),
    rate_code: roomAssignment?.roomTypeID ?? null,
    customer: mapGuestToCustomer(mainGuest, hotel.id, phoneNumber),
    hotel: hotelDto,
    hotel_configuration: hotelConfiguration,
    channel: null,
    payments: null,
    quote: null,
    discount: null,
    reservation_source: mapCloudbedsReservationSource(
      reservation.source || reservation.sourceName,
      reservation.origin,
    ),
  };
}

export function findMainGuest(
  guestList: Record<string, CloudbedsGetReservationGuestEntry> | undefined,
): CloudbedsGetReservationGuestEntry | undefined {
  if (!guestList) {
    return undefined;
  }

  const guests = Object.values(guestList);
  if (!guests.length) {
    return undefined;
  }

  return guests.find((guest) => guest.isMainGuest) ?? guests[0];
}

function mapGuestToCustomer(
  guest: CloudbedsGetReservationGuestEntry | undefined,
  hotelId: string,
  phoneNumber: string,
): Customer {
  if (!guest) {
    return {
      phone_number: phoneNumber,
      hotel_id: hotelId,
    };
  }

  return {
    phone_number:
      guest.guestCellPhone?.trim() || guest.guestPhone?.trim() || phoneNumber,
    hotel_id: hotelId,
    first_name: guest.guestFirstName,
    last_name: guest.guestLastName,
    email: guest.guestEmail,
    address:
      guest.guestAddress ||
      guest.guestCity ||
      guest.guestState ||
      guest.guestCountry ||
      guest.guestZip
        ? {
            address_first_line: guest.guestAddress,
            city: guest.guestCity,
            state_or_province: guest.guestState,
            postal_code: guest.guestZip,
            country: guest.guestCountry,
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

function parseIntSafe(value: string | undefined): number {
  if (!value?.trim()) {
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDateSafe(value: string | undefined): Date | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed;
}

function parseRequiredDate(
  value: string | undefined,
  fieldLabel: string,
): Date {
  const parsed = parseDateSafe(value);
  if (!parsed) {
    throw new Error(
      `mapCloudbedsGetReservationToReservationDTO: Invalid ${fieldLabel}: ${value ?? 'missing'}`,
    );
  }
  return parsed;
}

export function mapCloudbedsStatus(
  status: string | undefined,
): ReservationStatus {
  switch (status?.toLowerCase()) {
    case 'canceled':
      return ReservationStatus.CANCELLED;
    case 'no_show':
      return ReservationStatus.NO_SHOW;
    case 'confirmed':
    case 'checked_in':
    case 'checked_out':
      return ReservationStatus.ACTIVE;
    case 'not_confirmed':
      return ReservationStatus.INACTIVE;
    default:
      return ReservationStatus.INACTIVE;
  }
}

function mapCloudbedsReservationSource(
  source: string | undefined,
  origin: string | undefined,
): ReservationSource {
  const combined = `${source ?? ''} ${origin ?? ''}`.toLowerCase();
  if (
    combined.includes('direct') ||
    combined.includes('website') ||
    combined.includes('walk')
  ) {
    return ReservationSource.DIRECT_HOTEL_RESERVATION;
  }
  return ReservationSource.THIRD_PARTY_RESERVATION;
}
