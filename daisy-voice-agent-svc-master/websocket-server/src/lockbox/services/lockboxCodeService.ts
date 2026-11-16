import {
  DropboxClient,
  dropboxClient,
  sharedLinkFingerprint,
} from '../../dropbox/client/DropboxClient';
import { Hotel } from '../../models/Hotel';
import { hotelService, HotelService } from '../../services/hotel/hotelService';
import {
  hotelConfigurationService,
  HotelConfigurationService,
} from '../../services/hotelConfiguration/hotelConfigurationService';
import {
  DoorLockConfig,
  LockboxBalancePolicy,
  LockboxLogProvider,
} from '../../types/hotelConfiguration';
import { KpiStat, KpiStatValue, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import {
  lockboxAssignmentDates,
  selectLockboxAssignment,
} from '../matching/assignmentDate';
import { phoneMatchKey } from '../matching/callerMatch';
import { findReservationLockboxes } from '../matching/lockboxMatch';
import { overriddenRoomNumber } from '../matching/roomNumberOverride';
import {
  checkLockboxStay,
  guestNamesInRoom,
  hasCaller,
  isSameRoom,
  LockboxCaller,
  LockboxStayCheck,
  LockboxStayRefusal,
  owesBalance,
} from '../matching/stayCheck';
import { parseLockboxWorkbook } from '../parsing/lockboxWorkbook';
import {
  LockboxCodeFailureReason,
  LockboxCodeMatch,
  LockboxCodeQuery,
  LockboxCodeResult,
  LockboxLog,
  LockboxPhoneQuery,
  LockboxStay,
} from '../types';
import { lockboxStayService, LockboxStayService } from './lockboxStayService';

const KPI_CONTEXT = 'LockboxCodeService.getLockboxCode';

/** The stay checks' refusals in the order they run: of several stays, the one that got furthest is told. */
const STAY_REFUSAL_ORDER: LockboxCodeFailureReason[] = [
  LockboxCodeFailureReason.RESERVATION_NOT_ACTIVE,
  LockboxCodeFailureReason.NOT_ARRIVING_TONIGHT,
  LockboxCodeFailureReason.NO_ROOM_ASSIGNED,
  LockboxCodeFailureReason.RESERVATION_MISMATCH,
  LockboxCodeFailureReason.BALANCE_DUE,
];

/** A stay that passed the stay check, and the rooms whose boxes the caller may have. */
interface VerifiedStay {
  stay: LockboxStay;
  rooms: string[];
}

/** Ids only, never a guest name, phone or code. */
type LogContext = Record<string, unknown>;

type Verification =
  | { stays: VerifiedStay[]; logContext: LogContext }
  | { refused: LockboxCodeResult };

function failure(reason: LockboxCodeFailureReason): LockboxCodeResult {
  return { success: false, reason };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The hotel's `door_lock_config.lockbox_balance_policy`, read defensively
 * since the stored config can be written without the API's validator:
 * anything but `allow_with_note` refuses.
 */
function balancePolicy(
  doorLockConfig: DoorLockConfig | null | undefined,
): LockboxBalancePolicy {
  return doorLockConfig?.lockbox_balance_policy ===
    LockboxBalancePolicy.ALLOW_WITH_NOTE
    ? LockboxBalancePolicy.ALLOW_WITH_NOTE
    : LockboxBalancePolicy.REFUSE;
}

/**
 * The room sent, as the stay check reads it. A room number that already
 * names one of the stay's rooms is kept as is, so an override for a numeric
 * room name can't rewrite a correct answer; otherwise the hotel's room number
 * overrides apply to it as to the stay's rooms, so a room sent by its PMS
 * name still names the same room.
 */
function requestedRoom(
  stay: LockboxStay,
  submitted: string | undefined,
  roomNumberOverrides: Record<string, string> | null | undefined,
): string | undefined {
  return submitted && stay.rooms.some((room) => isSameRoom(room, submitted))
    ? submitted
    : (overriddenRoomNumber(submitted, roomNumberOverrides) ?? submitted);
}

/**
 * Looks up a late-arrival lockbox code in the hotel's own lockbox log
 * (`door_lock_config.lockbox_log`), downloaded fresh from Dropbox (cached
 * for a minute), for reservations read live from the hotel's PMS: the one
 * the agent found (`booking_id`), or, without one, those of tonight's
 * arrivals with the caller's phone number.
 *
 * Only a reservation that is active, checks in on the date of the assignment
 * in force, has a room assigned and (under the hotel's default balance
 * policy) owes nothing gets a code, and only for the rooms the caller (one of
 * its guests) may have. Boxes are matched on those rooms and the names the
 * PMS lists in them, never on what the agent sends, so an agent talked into
 * other values can't reach another guest's box.
 *
 * Everything the agent can act on comes back as a result rather than an
 * error: `success: false` with a reason, which the prompt turns into an
 * apology and an offer to transfer. Logs carry ids, counts, dates and the
 * balance owed only, never a guest name, phone number or code.
 */
export class LockboxCodeService {
  constructor(
    private readonly hotels: HotelService = hotelService,
    private readonly hotelConfigurations: HotelConfigurationService = hotelConfigurationService,
    private readonly dropbox: DropboxClient = dropboxClient,
    private readonly stays: Pick<
      LockboxStayService,
      'supports' | 'getStay' | 'findStaysByPhone' | 'isOnlyArrivalWithGuestName'
    > = lockboxStayService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getLockboxCode(
    hotelId: string,
    query: LockboxCodeQuery | LockboxPhoneQuery,
  ): Promise<LockboxCodeResult> {
    const now = this.now();
    const [hotel, configuration] = await Promise.all([
      this.hotels.getHotelById(hotelId),
      this.hotelConfigurations.getHotelConfigurationByHotelId(hotelId),
    ]);
    const clientId = hotel.assistant_phone_number;
    const doorLockConfig = configuration?.door_lock_config;
    const lockboxLog = doorLockConfig?.lockbox_log;

    if (
      lockboxLog?.provider !== LockboxLogProvider.DROPBOX_EXCEL ||
      !lockboxLog.shared_link
    ) {
      logger.error(
        'LockboxCodeService: hotel has no door_lock_config.lockbox_log',
        { hotelId },
      );
      return failure(LockboxCodeFailureReason.NOT_CONFIGURED);
    }

    const verification =
      'bookingId' in query
        ? await this.verifyStay(hotel, query, now, doorLockConfig)
        : await this.verifyStaysByPhone(hotel, query, now, doorLockConfig);
    if ('refused' in verification) return verification.refused;
    const { stays, logContext } = verification;

    const link = sharedLinkFingerprint(lockboxLog.shared_link);
    let bytes: Buffer;
    try {
      bytes = await this.dropbox.getSharedLinkFile(lockboxLog.shared_link);
    } catch (error) {
      logger.error('LockboxCodeService: could not download the lockbox log', {
        hotelId,
        link,
        error: errorMessage(error),
      });
      this.emitKpi(KpiStat.LockboxLogFetchFailed, clientId);
      return failure(LockboxCodeFailureReason.LOG_UNAVAILABLE);
    }

    let log: LockboxLog;
    try {
      log = await parseLockboxWorkbook(bytes);
    } catch (error) {
      logger.error('LockboxCodeService: could not read the lockbox log', {
        hotelId,
        link,
        error: errorMessage(error),
      });
      this.emitKpi(KpiStat.LockboxLogParseFailed, clientId);
      return failure(LockboxCodeFailureReason.LOG_UNAVAILABLE);
    }

    const assignment = selectLockboxAssignment(log, hotel.timezone, now);
    if (!assignment) {
      logger.warn('LockboxCodeService: lockbox log has nothing for today', {
        hotelId,
        todayTabDate: log.today.date,
        timezone: hotel.timezone,
      });
      this.emitKpi(KpiStat.LockboxLogNoAssignment, clientId);
      return failure(LockboxCodeFailureReason.NO_ASSIGNMENT_TODAY);
    }

    const arriving = stays.filter(
      ({ stay }) => stay.checkIn === assignment.date,
    );
    if (arriving.length === 0) {
      return this.refuse(
        hotel,
        logContext,
        { reason: LockboxCodeFailureReason.NOT_ARRIVING_TONIGHT },
        {
          checkIn: [...new Set(stays.map(({ stay }) => stay.checkIn))].join(
            ', ',
          ),
          assignmentDate: assignment.date,
        },
      );
    }

    const lockboxes = new Map<string, LockboxCodeMatch>();
    let lookupFailed = false;
    for (const { stay, rooms } of arriving) {
      // A box with no room is tied to the stay by name alone: only for a
      // single-room stay, and only once no other arrival has the same name.
      const match = findReservationLockboxes(
        assignment.entries,
        rooms.map((roomNumber) => ({
          roomNumber,
          guestNames: guestNamesInRoom(stay, roomNumber),
        })),
        stay.rooms.length === 1
          ? { guestName: stay.guestName, roomNumber: stay.rooms[0] }
          : undefined,
      );
      const outcome = {
        hotelId,
        ...logContext,
        reservationId: stay.reservationId,
        date: assignment.date,
        source: assignment.source,
        lockboxCount: assignment.entries.length,
        roomCount: rooms.length,
        matchedBy: match?.matchedBy ?? null,
        matchCount: match?.lockboxes.length ?? 0,
      };

      if (!match) {
        logger.info(
          "LockboxCodeService: no lockbox matched the reservation's rooms and guests",
          outcome,
        );
        continue;
      }

      if (match.matchedBy === 'name_only') {
        let onlyArrival: boolean;
        try {
          onlyArrival = await this.stays.isOnlyArrivalWithGuestName(
            hotel,
            stay,
          );
        } catch (error) {
          logger.error(
            'LockboxCodeService: could not check the PMS for other arrivals with the guest name',
            { ...outcome, error: errorMessage(error) },
          );
          lookupFailed = true;
          continue;
        }
        if (!onlyArrival) {
          logger.warn(
            'LockboxCodeService: a blank-room box has the guest name, but so may another arrival',
            outcome,
          );
          continue;
        }
      }

      logger.info('LockboxCodeService: lockbox code resolved', outcome);
      if (owesBalance(stay)) {
        logger.info(
          'LockboxCodeService: code given while a balance is owed (lockbox_balance_policy allow_with_note)',
          { ...outcome, balance: stay.balance },
        );
      }
      match.lockboxes.forEach((box) => {
        if (!lockboxes.has(box.lockbox_number)) {
          lockboxes.set(box.lockbox_number, box);
        }
      });
    }

    if (lockboxes.size === 0) {
      if (lookupFailed) {
        this.emitKpi(KpiStat.LockboxReservationLookupFailed, clientId);
        return failure(LockboxCodeFailureReason.RESERVATION_LOOKUP_FAILED);
      }
      this.emitKpi(KpiStat.LockboxCodeNotFound, clientId);
      return failure(LockboxCodeFailureReason.NOT_FOUND);
    }

    this.emitKpi(KpiStat.LockboxCodeResolved, clientId);
    const found = [...lockboxes.values()];
    const [first] = found;
    return {
      success: true,
      lockbox_number: first.lockbox_number,
      code: first.code,
      ...(first.note ? { note: first.note } : {}),
      lockboxes: found,
    };
  }

  /**
   * The reservation behind `booking_id`, read live from the PMS, and the
   * rooms whose boxes the caller (`customer_name`) may have; otherwise the
   * refusal, already logged and counted. Fails closed: a PMS that can't be
   * asked refuses too.
   */
  private async verifyStay(
    hotel: Hotel,
    query: LockboxCodeQuery,
    now: Date,
    doorLockConfig: DoorLockConfig | null | undefined,
  ): Promise<Verification> {
    const logContext = { bookingId: query.bookingId };
    const unsupported = this.refuseUnsupportedPms(hotel);
    if (unsupported) return unsupported;

    let stay: LockboxStay | null;
    try {
      stay = await this.stays.getStay(
        hotel,
        query.bookingId,
        doorLockConfig?.room_number_overrides,
      );
    } catch (error) {
      logger.error(
        'LockboxCodeService: could not load the reservation from the PMS',
        {
          hotelId: hotel.id,
          bookingId: query.bookingId,
          error: errorMessage(error),
        },
      );
      this.emitKpi(
        KpiStat.LockboxReservationLookupFailed,
        hotel.assistant_phone_number,
      );
      return {
        refused: failure(LockboxCodeFailureReason.RESERVATION_LOOKUP_FAILED),
      };
    }

    if (!stay) {
      return {
        refused: this.refuse(hotel, logContext, {
          reason: LockboxCodeFailureReason.RESERVATION_NOT_FOUND,
        }),
      };
    }

    const check = checkLockboxStay(
      stay,
      {
        customerName: query.customerName,
        roomNumber: requestedRoom(
          stay,
          query.roomNumber,
          doorLockConfig?.room_number_overrides,
        ),
      },
      lockboxAssignmentDates(hotel.timezone, now),
      balancePolicy(doorLockConfig),
    );
    if ('refusal' in check) {
      return {
        refused: this.refuse(hotel, logContext, check.refusal, {
          checkIn: stay.checkIn,
        }),
      };
    }
    return { stays: [{ stay, rooms: check.rooms }], logContext };
  }

  /**
   * Without a booking id: tonight's live arrivals with a guest whose phone
   * number is the caller's, read live from the PMS, and the rooms whose boxes
   * the caller may have on each; otherwise the refusal, already logged and
   * counted.
   *
   * - A number the caller didn't give, or gave as the one they call from:
   *   the caller ID identifies them as the guests with that number, no name
   *   needed.
   * - Another number they gave: the stays it finds count only with a guest
   *   whose last name is the caller's, and the caller is that guest. Without
   *   a last name the answer is `last_name_required`, before the PMS is
   *   asked. A wrong one is `reservation_not_found`, as for an unknown
   *   number, so a phone number alone reveals nothing about a booking.
   *
   * Each stay then passes the same checks as one found by booking id; the
   * stays that pass all count, and if none does, the refusal of the one that
   * got furthest is told. Fails closed, like the booking id lookup.
   */
  private async verifyStaysByPhone(
    hotel: Hotel,
    query: LockboxPhoneQuery,
    now: Date,
    doorLockConfig: DoorLockConfig | null | undefined,
  ): Promise<Verification> {
    const clientId = hotel.assistant_phone_number;
    const { callerPhone, bookingPhone, lastName } = query;
    const callerIdKey = phoneMatchKey(callerPhone);
    const byCallerId =
      bookingPhone === undefined ||
      (callerIdKey !== null && phoneMatchKey(bookingPhone) === callerIdKey);
    const logContext: LogContext = {
      identifiedBy: byCallerId ? 'caller_id' : 'booking_phone',
    };

    const unsupported = this.refuseUnsupportedPms(hotel);
    if (unsupported) return unsupported;

    let phone: string;
    let caller: LockboxCaller;
    if (byCallerId) {
      phone = callerPhone;
      caller = { callerPhone };
    } else if (!lastName) {
      logger.info(
        "LockboxCodeService: a phone number the caller gave needs the caller's last name too",
        { hotelId: hotel.id },
      );
      return {
        refused: failure(LockboxCodeFailureReason.LAST_NAME_REQUIRED),
      };
    } else {
      phone = bookingPhone;
      caller = { lastName };
    }

    const dates = lockboxAssignmentDates(hotel.timezone, now);
    let found: LockboxStay[];
    try {
      found = await this.stays.findStaysByPhone(
        hotel,
        phone,
        dates,
        doorLockConfig?.room_number_overrides,
      );
    } catch (error) {
      logger.error(
        "LockboxCodeService: could not look up tonight's arrivals in the PMS",
        { hotelId: hotel.id, ...logContext, error: errorMessage(error) },
      );
      this.emitKpi(KpiStat.LockboxReservationLookupFailed, clientId);
      return {
        refused: failure(LockboxCodeFailureReason.RESERVATION_LOOKUP_FAILED),
      };
    }

    const identified =
      'lastName' in caller
        ? found.filter((stay) => hasCaller(stay, caller))
        : found;
    if (identified.length === 0) {
      this.emitKpi(KpiStat.LockboxPhoneLookupNotFound, clientId);
      return {
        refused: this.refuse(
          hotel,
          logContext,
          { reason: LockboxCodeFailureReason.RESERVATION_NOT_FOUND },
          { phoneMatches: String(found.length) },
        ),
      };
    }
    this.emitKpi(
      byCallerId
        ? KpiStat.LockboxPhoneLookupCallerIdMatched
        : KpiStat.LockboxPhoneLookupBookingPhoneMatched,
      clientId,
    );

    const context: LogContext = {
      ...logContext,
      reservationIds: identified.map((stay) => stay.reservationId),
    };
    const policy = balancePolicy(doorLockConfig);
    const checked = identified.map((stay) => ({
      stay,
      check: checkLockboxStay(
        stay,
        {
          ...caller,
          roomNumber: requestedRoom(
            stay,
            query.roomNumber,
            doorLockConfig?.room_number_overrides,
          ),
        },
        dates,
        policy,
      ),
    }));
    const verified = checked.flatMap(({ stay, check }) =>
      'rooms' in check ? [{ stay, rooms: check.rooms }] : [],
    );
    if (verified.length > 0) return { stays: verified, logContext: context };

    const furthest = furthestRefusal(checked);
    return {
      refused: this.refuse(hotel, context, furthest.refusal, {
        checkIn: furthest.stay.checkIn,
      }),
    };
  }

  private refuseUnsupportedPms(
    hotel: Hotel,
  ): { refused: LockboxCodeResult } | null {
    if (this.stays.supports(hotel)) return null;
    logger.error(
      "LockboxCodeService: the hotel's PMS can't load a reservation by id",
      { hotelId: hotel.id, pmsProvider: hotel.pms_provider },
    );
    this.emitKpi(
      KpiStat.LockboxReservationLookupFailed,
      hotel.assistant_phone_number,
    );
    return {
      refused: failure(LockboxCodeFailureReason.RESERVATION_LOOKUP_UNSUPPORTED),
    };
  }

  private refuse(
    hotel: Hotel,
    logContext: LogContext,
    refusal: LockboxStayRefusal,
    details: Record<string, string> = {},
  ): LockboxCodeResult {
    const context = {
      hotelId: hotel.id,
      ...logContext,
      reason: refusal.reason,
      ...details,
    };
    if (refusal.reason === LockboxCodeFailureReason.RESERVATION_MISMATCH) {
      logger.warn(
        'LockboxCodeService: the request contradicts the reservation',
        {
          ...context,
          mismatched: refusal.mismatched,
        },
      );
      this.emitKpi(
        KpiStat.LockboxReservationMismatch,
        hotel.assistant_phone_number,
      );
    } else if (refusal.reason === LockboxCodeFailureReason.BALANCE_DUE) {
      if (refusal.balance === null || refusal.balance === undefined) {
        logger.warn(
          'LockboxCodeService: the PMS gave no readable balance for the reservation, so it counts as owed',
          context,
        );
      } else {
        logger.info('LockboxCodeService: the reservation has a balance due', {
          ...context,
          balance: refusal.balance,
        });
      }
      this.emitKpi(
        KpiStat.LockboxReservationBalanceDue,
        hotel.assistant_phone_number,
      );
    } else {
      logger.info(
        'LockboxCodeService: the reservation cannot have a lockbox code',
        context,
      );
      this.emitKpi(
        KpiStat.LockboxReservationNotVerified,
        hotel.assistant_phone_number,
      );
    }
    return failure(refusal.reason);
  }

  private emitKpi(stat: KpiStatValue, clientId: string): void {
    logKpi({ stat, value: 1, contextName: KPI_CONTEXT, clientId });
  }
}

/** Of stays that were all refused, the first whose refusal came from the latest check. */
function furthestRefusal(
  checked: { stay: LockboxStay; check: LockboxStayCheck }[],
): { stay: LockboxStay; refusal: LockboxStayRefusal } {
  const refused = checked.flatMap(({ stay, check }) =>
    'refusal' in check ? [{ stay, refusal: check.refusal }] : [],
  );
  return refused.reduce((furthest, candidate) =>
    STAY_REFUSAL_ORDER.indexOf(candidate.refusal.reason) >
    STAY_REFUSAL_ORDER.indexOf(furthest.refusal.reason)
      ? candidate
      : furthest,
  );
}

export const lockboxCodeService = new LockboxCodeService();
