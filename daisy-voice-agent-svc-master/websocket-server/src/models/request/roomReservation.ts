import { SessionType } from '../../dtos/enum/SessionType';
import { GetSingleRoomAvailabilityRequestParams } from './availability';

export interface CreateRoomReservationRequest {
  check_in: string;
  check_out: string;
  room_id: number | string;
  unit_group_id?: number;
  num_adults: number;
  session_type: SessionType;
  num_children?: number;
  num_pets?: number;
  customer_first_name: string;
  customer_address_state_or_province?: string;
  customer_address_postal_code?: string;
  customer_last_name: string;
  customer_phone_number: string;
  customer_email?: string;
  customer_special_request?: string;
  /** Rate code selected by the user (e.g. "BAR"). Used to fetch the quote for the exact rate. */
  rate_code?: string;
}

interface OccupantGroup {
  num_adults: number;
  num_children: number;
  num_pets?: number; // Optional number of pets for this occupant group
}

export interface PeoplePerRoom {
  [roomId: string]: OccupantGroup[];
}

export interface CreateMultiRoomReservationRequest {
  check_in: string;
  check_out: string;
  room_ids: number[];
  unit_group_ids?: number[];
  people_per_room: PeoplePerRoom;
  customer_first_name: string;
  customer_last_name: string;
  customer_phone_number: string;
  session_type: SessionType;
  customer_email?: string;
  customer_address_state_or_province?: string;
  customer_address_postal_code?: string;
  customer_special_request?: string;
  // An optional parameter needed for stayntouch pms
  rate_code?: string;
  /** Maps each room_id (as string) to the rate code selected by the user. */
  rate_codes_per_room?: Record<string, string>;
}

export interface CreateWebRoomReservationRequest {
  business_id: string;
  check_in: string;
  check_out: string;
  room_ids: number[];
  unit_group_ids?: number[];
  people_per_room: PeoplePerRoom;
  customer_first_name: string;
  customer_last_name: string;
  customer_phone_number: string;
  customer_email: string;
  customer_address_state_or_province: string;
  customer_address_postal_code: string;
  // An optional parameter needed for stayntouch pms
  rate_code?: string;
  /** Maps each room_id (as string) to the rate code selected by the user. */
  rate_codes_per_room?: Record<string, string>;
}

export interface GetReservationDetailsRequest {
  booking_id?: string;
  last_digits_phone_number?: string;
  guest_name?: string;
  /** YYYY-MM-DD. Optional; when present, further narrows a guest_name lookup. */
  check_out_date?: string;
  /**
   * Last 4 characters of the reservation id. Optional; when present, further
   * narrows a guest_name (+ check_out_date) lookup.
   */
  reservation_id_last_four?: string;
  session_type: SessionType;
}

export interface GetDoorCodeRequest {
  /**
   * External / PMS confirmation number, or Daisy's own `BK...` id. Cloudbeds
   * hotels with `door_lock_config.source_of_truth = daisy` may leave it out
   * to look the caller's stay up by the caller ID.
   */
  booking_id?: string;
  guest_name?: string;
  /** YYYY-MM-DD. Required whenever guest_name is the lookup key. */
  check_out_date?: string;
  session_type: SessionType;
}

export interface GetLockboxCodeRequest {
  /**
   * Optional: the reservation the agent found earlier in the call: the PMS
   * reservation id, an OTA confirmation number, or Daisy's own `BK...` id.
   * Voice tools may send it as a number. Without it (blank or null too),
   * Daisy finds tonight's reservation(s) by phone number instead.
   */
  booking_id?: string | number | null;
  /**
   * The caller's "First Last", required with `booking_id`; refused unless it
   * is a guest's on the reservation, and decides which of its rooms the
   * caller may have. Not used without `booking_id`.
   */
  customer_name?: string | null;
  /** Optional: answers for this one room; refused when it isn't the reservation's. */
  room_number?: string | number | null;
  /**
   * Without `booking_id`, optional: the phone number the caller says is on
   * the booking. Without it, the caller ID is used.
   */
  booking_phone?: string | number | null;
  /** Without `booking_id`: the caller's last name, needed with a `booking_phone` that isn't the caller ID. */
  last_name?: string | null;
  session_type: SessionType;
}

export interface GetReservationStatusInWordsRequest {
  booking_id: string;
}

export interface CancelReservationRequest {
  booking_id: string;
  reason?: string;
}

export interface ModifyRoomReservationRequest {
  booking_id: string;
  check_in: string;
  check_out: string;
  caller_phone_number: string;
  new_room_type_id?: number | string;
  new_rate_code?: string;
  room_changed?: boolean;
  num_pets_to_add?: number;
  customer_special_request?: string;
}

export interface CheckModificationAvailabilityRequest extends GetSingleRoomAvailabilityRequestParams {
  booking_id: string;
}

export interface CheckSisterPropertyAvailabilityRequest {
  start_date: string;
  end_date: string;
  num_adults: number;
  num_children?: number;
  num_pets?: number;
}

import { PaginationQueryParams } from './common';

export interface GetHotelReservationListQueryParams extends PaginationQueryParams {
  search?: string;
  channel?: string; // Comma-separated values: SMS,CALL,CHAT,WEB
  status?: string; // Comma-separated values: ACTIVE,CANCELLED
}
