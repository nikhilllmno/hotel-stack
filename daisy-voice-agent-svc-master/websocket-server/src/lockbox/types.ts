import { ReservationStatus } from '../dtos/enum/ReservationStatus';

/** One lockbox row of the log: a Today tab row, or one archived row. */
export interface LockboxLogEntry {
  lockboxNumber: string;
  guestName: string;
  /** Archive only: the name as first typed. '' when the column is absent or blank. */
  originalNameText: string;
  /** ROOM and ROOM 2, whichever are filled in. */
  rooms: string[];
  /** Always text; '' when the cell is blank. */
  code: string;
  /** NOTES as staff typed it; '' when the column is absent or blank. */
  notes: string;
}

export interface LockboxLog {
  sheetNames: string[];
  today: {
    /** The Today tab's date (YYYY-MM-DD), or null when it can't be read as a date. */
    date: string | null;
    entries: LockboxLogEntry[];
  };
  /**
   * Archived entries by date (YYYY-MM-DD), sorted by lockbox number. A date
   * archived more than once keeps each lockbox's most recent archived row.
   */
  archive: Map<string, LockboxLogEntry[]>;
}

/** A lockbox request from the agent, validated. */
export interface LockboxCodeQuery {
  /**
   * The reservation the agent found earlier in the call: the PMS reservation
   * id, an OTA confirmation number the PMS holds, or Daisy's own `BK…` id.
   */
  bookingId: string;
  /**
   * The caller's first and last name. It must be the name of a guest on the
   * reservation, and decides which of its rooms the caller may have.
   */
  customerName: string;
  /** Optional: one of the reservation's rooms, to answer for that room only. */
  roomNumber?: string;
}

/**
 * A lockbox request without a booking id, validated: Daisy finds the
 * caller's reservation(s) among tonight's arrivals by phone number.
 */
export interface LockboxPhoneQuery {
  /**
   * The session's caller number, which identifies the caller on its own:
   * the caller ID on a call, the sender on SMS. '' when the session has no
   * real phone number (web chat sends an id here).
   */
  callerPhone: string;
  /**
   * The number the caller says is on the booking. Unless it is the caller's
   * own number, `lastName` must also be a guest's on the reservation.
   */
  bookingPhone?: string;
  /** The caller's last name, as they said it. */
  lastName?: string;
  /** Optional: one of the reservation's rooms, to answer for that room only. */
  roomNumber?: string;
}

/** A guest on the reservation other than the main guest. */
export interface LockboxStayGuest {
  /** First and last name. */
  name: string;
  /** The last name alone, as the PMS holds it. */
  lastName: string;
  /** The guest's phone and cell phone numbers, as the PMS holds them. */
  phones: string[];
  /** The stay's rooms the PMS puts this guest in. */
  rooms: string[];
}

/** The reservation behind a lockbox request, read live from the hotel's PMS. */
export interface LockboxStay {
  /** The PMS's own reservation id, whichever id the agent sent. */
  reservationId: string;
  /** Daisy's normalized status, as the reservation lookup reports it. */
  status: ReservationStatus;
  /** The PMS says the stay is checked out, which `status` still reports as ACTIVE. */
  checkedOut: boolean;
  /** YYYY-MM-DD, on the hotel's own calendar. '' when the PMS has none. */
  checkIn: string;
  /**
   * The rooms assigned from the check-in date, each as the reservation lookup
   * reports `room_number`: the number at the end of the room's name, or the
   * whole name when it doesn't end in one.
   */
  rooms: string[];
  /** The main guest's first and last name. The main guest may have every room. */
  guestName: string;
  /** The main guest's last name alone, as the PMS holds it. */
  guestLastName: string;
  /** The main guest's phone and cell phone numbers, as the PMS holds them. */
  guestPhones: string[];
  /** The other guests the PMS puts in the stay's rooms; each may have only those rooms. */
  otherGuests: LockboxStayGuest[];
  /**
   * What the PMS says is still owed on the reservation; zero or less when
   * nothing is. Null when it sent no balance, or one that isn't a number.
   */
  balance: number | null;
}

export interface LockboxCodeMatch {
  lockbox_number: string;
  room_number: string;
  code: string;
  /** The box's NOTES, when staff wrote any. */
  note?: string;
}

export enum LockboxCodeFailureReason {
  /** The hotel has no `door_lock_config.lockbox_log`. */
  NOT_CONFIGURED = 'not_configured',
  /**
   * The caller gave a phone number on the booking that isn't the number they
   * call from, but no last name to go with it.
   */
  LAST_NAME_REQUIRED = 'last_name_required',
  /** The hotel's PMS can't load a reservation by id, so no request can be verified. */
  RESERVATION_LOOKUP_UNSUPPORTED = 'reservation_lookup_unsupported',
  /**
   * A PMS lookup failed or timed out: the reservation itself, or the check
   * for other arrivals with the guest's name that a blank-room box needs.
   */
  RESERVATION_LOOKUP_FAILED = 'reservation_lookup_failed',
  /**
   * The hotel's PMS has no reservation with this id for this property. Without
   * a booking id: no live arrival tonight has a guest with the phone number
   * (and, for a number the caller gave, a guest with their last name).
   */
  RESERVATION_NOT_FOUND = 'reservation_not_found',
  /** The reservation is cancelled, a no-show, checked out or not confirmed. */
  RESERVATION_NOT_ACTIVE = 'reservation_not_active',
  /** The reservation doesn't check in on the date the lockbox assignment in force is for. */
  NOT_ARRIVING_TONIGHT = 'not_arriving_tonight',
  /** The reservation has no room assigned for its check-in date. */
  NO_ROOM_ASSIGNED = 'no_room_assigned',
  /**
   * The name sent isn't a guest's on the reservation (or not one in the room
   * sent), or the room sent isn't one of its rooms.
   */
  RESERVATION_MISMATCH = 'reservation_mismatch',
  /**
   * The reservation still has an amount owing, or the PMS gave no balance
   * that can be read: the hotel collects it before a self check-in.
   */
  BALANCE_DUE = 'balance_due',
  /** The log could not be downloaded or read. */
  LOG_UNAVAILABLE = 'log_unavailable',
  /** The log has no assignments for today: the Today tab is stale and today isn't archived. */
  NO_ASSIGNMENT_TODAY = 'no_assignment_today',
  /**
   * No lockbox in the assignment matches the reservation's rooms and guests,
   * or the only match is a blank-room box whose name another arrival has too.
   */
  NOT_FOUND = 'not_found',
}

export type LockboxCodeResult =
  | {
      success: true;
      /** The first match, repeated at the top level for simple prompts. */
      lockbox_number: string;
      code: string;
      note?: string;
      lockboxes: LockboxCodeMatch[];
    }
  | { success: false; reason: LockboxCodeFailureReason };
