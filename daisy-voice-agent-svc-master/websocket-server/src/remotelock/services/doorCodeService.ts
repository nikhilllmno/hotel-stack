import { NoDataError } from '../../errors/NoDataError';
import { hotelService, HotelService } from '../../services/hotel/hotelService';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';
import { createKeyedSingleFlightRunner } from '../../utils/single-flight';
import { RemoteLockClient } from '../client/RemoteLockClient';
import { isSameCalendarDate, overlapsDateRange } from '../matching/dateOverlap';
import {
  isIdentityMatch,
  ReservationIdentity,
} from '../matching/identityMatch';
import { AccessGuest } from '../types';

export interface DoorCodeReservation extends ReservationIdentity {
  check_in: string | Date;
  check_out: string | Date;
}

export interface BookingDoorCodeReservation extends DoorCodeReservation {
  booking_id: string;
}

/**
 * A door-code lookup re-fetches the hotel's whole access-guest list, which is
 * several paginated calls against a 120 req/min per-account budget. Concurrent
 * voice calls at one hotel ask for the same list, so it is cached for a few
 * seconds — short enough that a code reissued after a room change is picked up
 * on the guest's next ask, long enough to collapse a burst into one fetch.
 */
const CANDIDATE_CACHE_TTL_MS = 15_000;

/** One matching RemoteLock access guest, as handed back to the caller. */
export interface DoorCodeMatch {
  pin: string;
  guest_name: string;
  starts_at: string;
  ends_at: string;
}

export type DoorCodeResult =
  | { status: 'resolved'; matches: DoorCodeMatch[] }
  | { status: 'ambiguous'; matches: DoorCodeMatch[] }
  | { status: 'not_found' };

/**
 * Hostaway rewrites the guest email it pushes to RemoteLock into a
 * sub-addressed form (`ann@x.com` -> `ann+12345@x.com`), so an email compare
 * would reject every otherwise-valid match. Name + phone + window overlap
 * still gate the match for these hotels.
 *
 * Unused while the email compare is disabled in `isIdentityMatch` — PMS and
 * RemoteLock emails disagree across all providers, not just Hostaway.
 */
// function shouldCompareEmail(pmsProvider?: string): boolean {
//   return pmsProvider?.toLowerCase() !== PmsProvider.HOSTAWAY;
// }

export type RemoteLockClientFactory = (hotelId: string) => RemoteLockClient;

/**
 * Resolves a guest's door PIN by matching RemoteLock `access_guest` records
 * against a reservation. Decided rule (see remotelock-door-code-matching):
 * first name required, email and phone not compared at all, and a date-level
 * (not exact) window overlap. No lock->room mapping — this only answers
 * "what's my code", not "which door".
 *
 * `createClient` is injected so tests can substitute a fake RemoteLockClient
 * instead of stubbing the HTTP layer.
 */
export class RemoteLockDoorCodeService {
  private readonly candidateCache = new Map<
    string,
    { expiresAt: number; guests: AccessGuest[] }
  >();

  private readonly candidateFetches = createKeyedSingleFlightRunner();

  constructor(
    private readonly createClient: RemoteLockClientFactory = (hotelId) =>
      new RemoteLockClient(hotelId),
    // Retained for the disabled per-PMS email compare; see shouldCompareEmail.
    private readonly hotels: HotelService = hotelService,
  ) {}

  /**
   * Resolves door PINs for a batch of reservations at one hotel — a booking
   * can cover several rooms, each with its own access guest.
   *
   * Matching on first name alone can pick up more than one access guest for a
   * reservation. Every match is returned with the guest name and window it
   * came from rather than one being guessed at, so the caller can tell them
   * apart.
   */
  async resolveDoorCodes(
    hotelId: string,
    reservations: BookingDoorCodeReservation[],
  ): Promise<(DoorCodeMatch & { booking_id: string })[]> {
    if (reservations.length === 0) {
      throw new NoDataError('resolveDoorCodes: no reservation found');
    }

    // Every reservation here belongs to the same hotel, so fetch the
    // access-guest list once and match each reservation against it in memory.
    const candidates = await this.getCandidates(hotelId);

    const doorCodes: (DoorCodeMatch & { booking_id: string })[] = [];

    reservations.forEach((reservation) => {
      const result = this.matchReservation(hotelId, candidates, reservation);
      if (result.status === 'not_found') return;

      result.matches.forEach((match) => {
        doorCodes.push({ booking_id: reservation.booking_id, ...match });
      });
    });

    if (doorCodes.length === 0) {
      throw new NoDataError('resolveDoorCodes: no door codes found');
    }

    return doorCodes;
  }

  /**
   * Resolves door PINs straight off RemoteLock for a guest-name + check-out
   * date lookup — the PMS is not consulted at all on this path. An access
   * guest matches when the first name matches and its `ends_at` falls on the
   * given calendar date (date only, no timezone handling, same as everywhere
   * else here).
   *
   * Every match is returned rather than one being picked, so a caller facing
   * two guests with the same first name and check-out date can tell them
   * apart by full name and stay window.
   */
  async resolveDoorCodesByGuestName(
    hotelId: string,
    guestName: string,
    checkOutDate: string,
  ): Promise<DoorCodeMatch[]> {
    const candidates = await this.getCandidates(hotelId);

    const matches = candidates.filter(
      (guest) =>
        isIdentityMatch(guest, { name: guestName }) &&
        isSameCalendarDate(guest.attributes.ends_at, checkOutDate),
    );

    const withPin = matches.filter((guest) => Boolean(guest.attributes.pin));

    if (withPin.length === 0) {
      logKpi({
        stat: KpiStat.RemoteLockDoorCodeNotFound,
        value: 1,
        contextName: 'RemoteLockDoorCodeService.resolveDoorCodesByGuestName',
        clientId: hotelId,
      });
      throw new NoDataError(
        'resolveDoorCodesByGuestName: no access guest with a readable PIN matched that guest name and check-out date',
      );
    }

    if (withPin.length > 1) {
      logKpi({
        stat: KpiStat.RemoteLockDoorCodeAmbiguous,
        value: 1,
        contextName: 'RemoteLockDoorCodeService.resolveDoorCodesByGuestName',
        clientId: hotelId,
      });
      logger.info(
        'RemoteLockDoorCodeService: multiple access guests matched the guest name and check-out date, returning all',
        { hotelId, matchCount: withPin.length },
      );
    } else {
      logKpi({
        stat: KpiStat.RemoteLockDoorCodeResolved,
        value: 1,
        contextName:
          'RemoteLockDoorCodeService.resolveDoorCodesByGuestName operation failed.',
        clientId: hotelId,
      });
    }

    return withPin.map((guest) => ({
      pin: guest.attributes.pin as string,
      guest_name: guest.attributes.name,
      starts_at: guest.attributes.starts_at,
      ends_at: guest.attributes.ends_at,
    }));
  }

  /**
   * Fetches the hotel's access-guest list — the only network call in a door
   * code lookup. Kept separate from {@link matchReservation} so a request
   * covering several reservations at one hotel fetches the list once instead
   * of once per reservation (RemoteLock allows 120 req/min per account).
   *
   * Cached for {@link CANDIDATE_CACHE_TTL_MS}, and concurrent misses for one
   * hotel share a single in-flight fetch instead of each starting their own.
   */
  async getCandidates(hotelId: string): Promise<AccessGuest[]> {
    const cached = this.candidateCache.get(hotelId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.guests;
    }

    return this.candidateFetches.run(hotelId, async () => {
      const client = this.createClient(hotelId);
      const guests = await client.getAllAccessPersons({ type: 'access_guest' });
      this.candidateCache.set(hotelId, {
        expiresAt: Date.now() + CANDIDATE_CACHE_TTL_MS,
        guests,
      });
      return guests;
    });
  }

  /**
   * Pure matching over an already-fetched candidate list — no I/O, so it
   * cannot fail on a network error.
   */
  matchReservation(
    hotelId: string,
    candidates: AccessGuest[],
    reservation: DoorCodeReservation,
  ): DoorCodeResult {
    const matches = candidates.filter(
      (guest) =>
        isIdentityMatch(guest, reservation) &&
        overlapsDateRange(
          { start: guest.attributes.starts_at, end: guest.attributes.ends_at },
          { start: reservation.check_in, end: reservation.check_out },
        ),
    );

    const withPin = matches.filter((guest) => Boolean(guest.attributes.pin));

    if (withPin.length === 0) {
      logKpi({
        stat: KpiStat.RemoteLockDoorCodeNotFound,
        value: 1,
        contextName: 'RemoteLockDoorCodeService.matchReservation',
        clientId: hotelId,
      });
      logger.info(
        'RemoteLockDoorCodeService: no access guest with a readable PIN matched the reservation',
        {
          hotelId,
          candidateCount: candidates.length,
          matchCount: matches.length,
        },
      );
      return { status: 'not_found' };
    }

    const doorCodeMatches = withPin.map((guest) => ({
      pin: guest.attributes.pin as string,
      guest_name: guest.attributes.name,
      starts_at: guest.attributes.starts_at,
      ends_at: guest.attributes.ends_at,
    }));

    if (withPin.length > 1) {
      logKpi({
        stat: KpiStat.RemoteLockDoorCodeAmbiguous,
        value: 1,
        contextName: 'RemoteLockDoorCodeService.matchReservation',
        clientId: hotelId,
      });
      logger.info(
        'RemoteLockDoorCodeService: multiple access guests matched, returning all',
        { hotelId, matchCount: withPin.length },
      );
      return { status: 'ambiguous', matches: doorCodeMatches };
    }

    logKpi({
      stat: KpiStat.RemoteLockDoorCodeResolved,
      value: 1,
      contextName: 'RemoteLockDoorCodeService.matchReservation',
      clientId: hotelId,
    });
    return { status: 'resolved', matches: doorCodeMatches };
  }
}

export const remoteLockDoorCodeService = new RemoteLockDoorCodeService();
