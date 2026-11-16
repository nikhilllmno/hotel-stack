import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Customer } from '../../dtos/Customer';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { SessionType } from '../../dtos/enum/SessionType';
import { Hotel as HotelDTO } from '../../dtos/Hotel';
import { HotelConfiguration } from '../../dtos/HotelConfiguration';
import { Reservation as ReservationDTO } from '../../dtos/Reservation';
import { Hotel } from '../../models/Hotel';
import { PmsProvider } from '../../types/enums';
import {
  GetReservationGuestResponse,
  GetReservationResponse,
} from '../types/GetReservationResponse';
import {
  ADDON_MODIFICATION_BLOCKED_NOTE,
  hasBlockingAddons,
  mapStayntouchSourceCodeToReservationSource,
} from './helper';

dayjs.extend(utc);
dayjs.extend(timezone);

export function mapStayntouchSearchResultsToReservationDTOs(
  results: GetReservationResponse[],
  hotel: Hotel,
  hotelConfiguration: HotelConfiguration | null,
  rateCodeMap: Map<number, string> = new Map(),
): ReservationDTO[] {
  const hotelDto = mapHotelToDto(hotel);

  return results.map((result) =>
    mapStayntouchSearchResultToReservationDTO(
      result,
      hotel,
      hotelDto,
      hotelConfiguration,
      rateCodeMap,
    ),
  );
}

function mapStayntouchSearchResultToReservationDTO(
  result: GetReservationResponse,
  hotel: Hotel,
  hotelDto: HotelDTO,
  hotelConfiguration: HotelConfiguration | null,
  rateCodeMap: Map<number, string>,
): ReservationDTO {
  const externalId = String(result.id);
  const confirmationNumber = (result.confirmation_number ?? '').toUpperCase();
  const primaryGuest = findPrimaryGuest(result.guests);
  const firstStayDate = result.stay_dates?.[0];
  const roomTypeId = firstStayDate?.room_type_id ?? 0;
  const phoneNumber = primaryGuest?.mobile_phone ?? '';
  const rateId = firstStayDate?.rate_id ?? null;

  const notes_from_partner = hasBlockingAddons(
    result.addons,
    hotelConfiguration?.addon_modification_allowlist,
  )
    ? ADDON_MODIFICATION_BLOCKED_NOTE
    : undefined;

  return {
    id: externalId,
    booking_id: confirmationNumber,
    external_id: externalId,
    external_public_id: result.confirmation_number,
    phone_number: phoneNumber,
    type: SessionType.EXTERNAL,
    room_id: roomTypeId,
    room_type: resolveRoomTypeName(hotel, roomTypeId),
    business_id: String(hotel.business_id),
    hotel_id: hotel.id,
    pms_provider: PmsProvider.STAYNTOUCH,
    status: mapStayntouchStatus(result.status),
    check_in: dayjs
      .tz(
        `${result.arrival_date}T${result.arrival_time ?? hotelConfiguration?.check_in_check_out_configuration?.check_in ?? '00:00'}`,
        hotel.timezone,
      )
      .toDate(),
    check_out: dayjs
      .tz(
        `${result.departure_date}T${result.departure_time ?? hotelConfiguration?.check_in_check_out_configuration?.check_out ?? '00:00'}`,
        hotel.timezone,
      )
      .toDate(),
    num_adults: firstStayDate?.adults ?? 0,
    num_children: firstStayDate?.children ?? 0,
    created_at: result.created_time ? new Date(result.created_time) : undefined,
    updated_at: result.updated_time ? new Date(result.updated_time) : undefined,
    rate_id: rateId,
    rate_code: rateId != null ? (rateCodeMap.get(rateId) ?? null) : null,
    notes_from_partner,
    customer: mapGuestToCustomer(primaryGuest, hotel.id, phoneNumber),
    hotel: hotelDto,
    hotel_configuration: hotelConfiguration,
    channel: null,
    payments: null,
    quote: null,
    discount: null,
    reservation_source: mapStayntouchSourceCodeToReservationSource(
      result.source_code,
    ),
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

function findPrimaryGuest(
  guests: GetReservationGuestResponse[] | undefined,
): GetReservationGuestResponse | undefined {
  if (!guests?.length) {
    return undefined;
  }

  return guests.find((guest) => guest.is_primary) ?? guests[0];
}

function mapGuestToCustomer(
  guest: GetReservationGuestResponse | undefined,
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
    phone_number: guest.mobile_phone || phoneNumber,
    hotel_id: hotelId,
    first_name: guest.first_name,
    last_name: guest.last_name,
    email: guest.email,
    address: guest.address
      ? {
          id: String(guest.address.id),
          state_or_province: guest.address.state,
          postal_code: guest.address.postal_code,
          country: guest.address.country_code,
          city: guest.address.city,
        }
      : null,
    billing_address: null,
  };
}

function resolveRoomTypeName(hotel: Hotel, roomTypeId: number): string {
  const roomType = hotel.room_types?.results.find(
    (entry) => entry.id === roomTypeId,
  );
  return roomType?.name ?? String(roomTypeId);
}

function mapStayntouchStatus(status: string): ReservationStatus {
  switch (status) {
    case 'RESERVED':
    case 'CHECKEDIN':
    case 'CHECKEDOUT':
      return ReservationStatus.ACTIVE;
    case 'CANCELED':
      return ReservationStatus.CANCELLED;
    case 'NOSHOW':
      return ReservationStatus.NO_SHOW;
    default:
      return ReservationStatus.ACTIVE;
  }
}
