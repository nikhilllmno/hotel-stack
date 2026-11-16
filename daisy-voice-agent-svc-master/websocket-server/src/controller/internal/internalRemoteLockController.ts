import { Request, Response } from 'express';
import { TokenError } from '../../errors/TokenError';
import { RemoteLockClient } from '../../remotelock/client/RemoteLockClient';
import {
  RemoteLockAPIError,
  RemoteLockConfigurationError,
} from '../../remotelock/errors';
import { KpiStat, logKpi } from '../../utils/kpiLogger';
import logger from '../../utils/logger';

/**
 * Machine-readable error codes. Alfred branches on these rather than on the
 * prose message, so they are part of the contract — don't rename them.
 */
export const RemoteLockPassthroughErrorCode = {
  /** Path param missing/blank. */
  InvalidRequest: 'invalid_request',
  /** RemoteLock has no such access person (deleted). Terminal. */
  AccessPersonNotFound: 'remotelock_access_person_not_found',
  /** Hotel has no stored RemoteLock token pair — not onboarded. Terminal. */
  NotOnboarded: 'remotelock_not_onboarded',
  /** Stored token was rejected by RemoteLock (401/403). Terminal. */
  AuthFailed: 'remotelock_auth_failed',
  /** RemoteLock unreachable, 5xx, or rate-limited. Retryable. */
  Unavailable: 'remotelock_unavailable',
  /** RemoteLock rejected the request itself (4xx other than 401/403/404/429). Terminal. */
  Rejected: 'remotelock_rejected',
  /** Daisy-side misconfiguration (e.g. REMOTELOCK_API_URL unset). */
  Misconfigured: 'remotelock_misconfigured',
  /** Unclassified Daisy-side failure. */
  InternalError: 'internal_error',
} as const;

type RemoteLockClientFactory = (hotelId: string) => RemoteLockClient;

/**
 * Read-only passthrough over RemoteLock's `access_persons` resource for
 * machine callers that already hold the reservation and only need the raw
 * access person — Alfred's RemoteLock webhook drain.
 *
 * Daisy holds the OAuth Application and the per-hotel token pair, so the
 * credential never leaves this service; `hotelId` in the path is the
 * token-scoping key.
 *
 * The RemoteLock resource is passed through unreshaped (`id`, `type`,
 * `attributes`) on purpose: reshaping would fork the contract from
 * RemoteLock's own, and callers already parse these field names.
 * `starts_at`/`ends_at` are timezone-less lock-local strings and are relayed
 * verbatim — do not normalize them here.
 */
export class InternalRemoteLockController {
  constructor(
    private readonly clientFactory: RemoteLockClientFactory = (hotelId) =>
      new RemoteLockClient(hotelId),
  ) {}

  /**
   * GET /internal/remotelock/hotels/:hotelId/access-persons/:accessPersonId
   *
   * 200 — `{ id, type, attributes }` straight from RemoteLock
   * 400 — blank path param
   * 404 — no such access person (caller should stop retrying)
   * 422 — hotel not onboarded, or its stored token was rejected (terminal)
   * 502 — RemoteLock unreachable / 5xx / 429 (caller should defer)
   */
  async getAccessPerson(req: Request, res: Response): Promise<void> {
    // No global error middleware — wrap the handler so errors are caught explicitly.
    const { hotelId, accessPersonId } = req.params as Record<string, string>;

    try {
      if (!hotelId?.trim() || !accessPersonId?.trim()) {
        res.status(400).json({
          code: RemoteLockPassthroughErrorCode.InvalidRequest,
          message: 'hotelId and accessPersonId are required path parameters',
        });
        return;
      }

      const accessPerson =
        await this.clientFactory(hotelId).getAccessPerson(accessPersonId);

      logKpi({
        stat: KpiStat.RemoteLockAccessPersonFetched,
        value: 1,
        contextName: 'InternalRemoteLockController.getAccessPerson',
        clientId: hotelId,
        contextId: accessPersonId,
      });

      res.status(200).json(accessPerson);
    } catch (error) {
      this.handleFailure(error, res, hotelId, accessPersonId);
    }
  }

  private handleFailure(
    error: unknown,
    res: Response,
    hotelId: string,
    accessPersonId: string,
  ): void {
    logger.error('InternalRemoteLockController.getAccessPerson failed', {
      hotelId,
      accessPersonId,
      error: error instanceof Error ? error.message : String(error),
    });

    logKpi({
      stat: KpiStat.RemoteLockAccessPersonFetchError,
      value: 1,
      contextName: 'InternalRemoteLockController.getAccessPerson',
      clientId: hotelId,
      contextId: accessPersonId,
    });

    const { status, code, message } = this.classify(error);
    res.status(status).json({ code, message });
  }

  private classify(error: unknown): {
    status: number;
    code: string;
    message: string;
  } {
    const message = error instanceof Error ? error.message : String(error);

    // No stored token pair for this hotel — a config problem, not a transient
    // one, so it must not read as retryable to the caller.
    if (error instanceof TokenError) {
      return {
        status: 422,
        code: RemoteLockPassthroughErrorCode.NotOnboarded,
        message,
      };
    }

    if (error instanceof RemoteLockConfigurationError) {
      return {
        status: 500,
        code: RemoteLockPassthroughErrorCode.Misconfigured,
        message,
      };
    }

    if (error instanceof RemoteLockAPIError) {
      if (error.statusCode === 404) {
        return {
          status: 404,
          code: RemoteLockPassthroughErrorCode.AccessPersonNotFound,
          message,
        };
      }

      // The stored token was rejected. Also terminal from the caller's side —
      // reissued as 422 so 401/403 on this endpoint keeps meaning "bad
      // x-api-key" (apiKeyMiddleware) and nothing else.
      if (error.statusCode === 401 || error.statusCode === 403) {
        return {
          status: 422,
          code: RemoteLockPassthroughErrorCode.AuthFailed,
          message,
        };
      }

      // Anything else in the 4xx range is RemoteLock rejecting the request
      // itself, so it must not read as retryable — retrying sends the same
      // request RemoteLock already refused.
      if (
        error.statusCode >= 400 &&
        error.statusCode < 500 &&
        error.statusCode !== 429
      ) {
        return {
          status: 422,
          code: RemoteLockPassthroughErrorCode.Rejected,
          message,
        };
      }

      // 429 and 5xx — including the client's 500-wrapped network errors.
      return {
        status: 502,
        code: RemoteLockPassthroughErrorCode.Unavailable,
        message,
      };
    }

    return {
      status: 500,
      code: RemoteLockPassthroughErrorCode.InternalError,
      message: 'Internal Server error',
    };
  }
}
