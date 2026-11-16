/**
 * CloudbedsWebhookService
 *
 * This is the decision-maker. When a webhook arrives, this service:
 * 1. Extracts the propertyID from the payload
 * 2. Looks up the hotel in our DB
 * 3. Fetches full reservation details from Cloudbeds API
 * 4. Decides whether to SKIP, CREATE, or UPDATE based on the decision tree
 * 5. Delegates DB work to CloudbedsReservationSyncService
 */

import config from '../../config';
import { CancellationSource } from '../../dtos/enum/CancellationSource';
import { ReservationStatus } from '../../dtos/enum/ReservationStatus';
import { CloudbedsClient } from '../client/CloudbedsClient';
import { CloudbedsConfigurationError } from '../errors';
import {
  CloudbedsAppStateChangedPayload,
  CloudbedsReservationCreatedPayload,
  CloudbedsReservationModifiedPayload,
  CloudbedsReservationStatusChangedPayload,
  CloudbedsWebhookBasePayload,
  CloudbedsWebhookResponse,
} from '../types/WebhookPayload';
import { resolveCloudbedsCredentials } from './cloudbedsCredentials';
import {
  CloudbedsReservationSyncService,
  cloudbedsReservationSyncService,
} from './CloudbedsReservationSyncService';

import {
  HotelService,
  hotelService as hotelServiceInstance,
} from '../../services/hotel/hotelService';
import {
  HotelConfigurationService,
  hotelConfigurationService as hotelConfigurationServiceInstance,
} from '../../services/hotelConfiguration/hotelConfigurationService';
import roomReservationServiceInstance, {
  RoomReservationService,
} from '../../services/roomReservation/roomReservationService';
import { SlackService } from '../../services/slack/slackService';
import logger from '../../utils/logger';

export class CloudbedsWebhookService {
  constructor(
    private readonly hotelService: HotelService = hotelServiceInstance,
    private readonly syncService: CloudbedsReservationSyncService = cloudbedsReservationSyncService,
    private readonly client: CloudbedsClient = new CloudbedsClient(),
    private readonly hotelConfigurationService: HotelConfigurationService = hotelConfigurationServiceInstance,
    private readonly roomReservationService: RoomReservationService = roomReservationServiceInstance,
    private readonly slackService: SlackService = new SlackService(),
  ) {}

  async handleWebhookEvent(
    payload: CloudbedsWebhookBasePayload,
  ): Promise<CloudbedsWebhookResponse> {
    const event = payload.event;

    logger.info('CloudbedsWebhookService: Received webhook event', {
      event,
      timestamp: payload.timestamp,
      version: payload.version,
    });

    // Webhook routing was deactivated (#1495); the remaining cases stay
    // commented out (not deleted) so they're easy to re-enable later.
    switch (event) {
      // case 'reservation/created':
      //   return this.handleReservationCreated(
      //     payload as CloudbedsReservationCreatedPayload,
      //   );
      case 'reservation/status_changed':
        return this.handleReservationStatusChanged(
          payload as CloudbedsReservationStatusChangedPayload,
        );
      // case 'reservation/dates_changed':
      // case 'reservation/accommodation_type_changed':
      //   return this.handleReservationModified(
      //     payload as CloudbedsReservationModifiedPayload,
      //   );
      case 'integration/appstate_changed':
        return this.handleAppStateChanged(
          payload as CloudbedsAppStateChangedPayload,
        );
      default:
        logger.info(
          `CloudbedsWebhookService: Event type not handled: ${event}`,
        );
        return { success: true, message: `Event type ${event} not handled` };
    }
  }

  /**
   * The decision tree for reservation/created:
   *
   * 1. Look up hotel by propertyID
   * 2. Resolve API credentials
   * 3. Fetch full reservation from Cloudbeds (getReservation)
   * 4. Find local reservation by Cloudbeds reservationID (external_id):
   *    - Exists and Daisy-originated (call/chat/sms/web + direct hotel
   *      reservation) → SKIP always
   *    - Exists otherwise (external) → UPDATE (duplicate webhook)
   *    - Not exists → CREATE (new external reservation)
   */
  private async handleReservationCreated(
    payload: CloudbedsReservationCreatedPayload,
  ): Promise<CloudbedsWebhookResponse> {
    const ids = this.resolveIdentifiers(
      payload as unknown as Record<string, unknown>,
    );
    if (!ids) {
      logger.warn(
        'CloudbedsWebhookService: reservation/created missing propertyID or reservationID',
        { payload: JSON.stringify(payload) },
      );
      return { success: true, message: 'Missing required identifiers' };
    }
    const { propertyID, reservationID } = ids;

    logger.info('CloudbedsWebhookService: Processing reservation/created', {
      propertyID,
      reservationID,
    });

    // ─── Step 1: Look up hotel by propertyID ───
    const hotel = await this.hotelService.getHotelByBusinessId(propertyID);
    if (!hotel) {
      logger.debug('CloudbedsWebhookService: Unknown propertyID, ignoring', {
        propertyID,
        reservationID,
      });
      return { success: true, message: 'Ignored: unknown property' };
    }

    // ─── Step 2: Resolve API credentials ───
    const { apiToken } = await resolveCloudbedsCredentials(hotel);

    // ─── Step 3: Fetch full reservation details ───
    const fullReservation = await this.client.getReservation(
      { propertyID, reservationID },
      { apiToken, hotelId: hotel.id },
    );

    logger.info(
      'CloudbedsWebhookService: Full reservation fetched from Cloudbeds',
      {
        reservationID,
        hotelId: hotel.id,
        thirdPartyIdentifier: fullReservation.thirdPartyIdentifier,
        status: fullReservation.status,
      },
    );

    // ─── Step 4: Find local reservation by Cloudbeds reservationID ───
    const localReservation = await this.syncService.findLocalReservation(
      hotel,
      reservationID,
    );

    // ─── Step 5: Check origin ───
    if (
      localReservation &&
      this.syncService.isDaisyOriginatedReservation(localReservation)
    ) {
      // Daisy created this reservation. SKIP always.
      logger.info(
        'CloudbedsWebhookService: Daisy-originated reservation, skipping',
        { reservationID, hotelId: hotel.id },
      );
      return {
        success: true,
        message: 'Daisy-originated reservation, skipped',
      };
    }

    if (localReservation) {
      // Duplicate webhook or Cloudbeds retry — update with fresh data
      logger.info(
        'CloudbedsWebhookService: External reservation already exists, updating',
        {
          reservationID,
          hotelId: hotel.id,
          localReservationId: localReservation.id,
        },
      );

      const { reservationId } = await this.syncService.syncUpdateReservation(
        fullReservation,
        hotel,
        localReservation,
      );

      return {
        success: true,
        message: 'Reservation updated',
        reservation_id: reservationId,
      };
    }

    // ─── Step 6: New external reservation — create it ───
    logger.info('CloudbedsWebhookService: New external reservation, creating', {
      reservationID,
      hotelId: hotel.id,
    });

    const { reservationId } = await this.syncService.syncCreateReservation(
      fullReservation,
      hotel,
    );

    return {
      success: true,
      message: 'Reservation created',
      reservation_id: reservationId,
    };
  }

  /**
   * The decision tree for reservation/status_changed — scoped to exactly one
   * outcome: a Dextr-originated reservation that gets cancelled directly in
   * Cloudbeds also gets cancelled in Dextr, via the same flow Dextr itself uses.
   * Every other status_changed transition, and any reservation not created
   * through Dextr, stays a no-op — that broader sync behavior remains
   * deactivated (#1495).
   *
   * 1. Early filter: only act on 'canceled' (ignore no_show, check-in/out, confirmed)
   * 2. Look up hotel by propertyID
   * 3. Find local reservation by external_id:
   *    - Not found → SKIP (never tracked this reservation)
   *    - Not Dextr-originated → SKIP (out of scope for this flow)
   *    - Already CANCELLED/NO_SHOW → SKIP (idempotent, handles bounce-back)
   *    - Not ACTIVE (e.g. INACTIVE/FAILED) → SKIP (nothing to cancel)
   *    - ACTIVE → cancel via RoomReservationService.cancelReservation(..., CancellationSource.PMS)
   */
  private async handleReservationStatusChanged(
    payload: CloudbedsReservationStatusChangedPayload,
  ): Promise<CloudbedsWebhookResponse> {
    const ids = this.resolveIdentifiers(
      payload as unknown as Record<string, unknown>,
    );
    if (!ids) {
      logger.warn(
        'CloudbedsWebhookService: reservation/status_changed missing propertyID or reservationID',
        { payload: JSON.stringify(payload) },
      );
      return { success: true, message: 'Missing required identifiers' };
    }
    const { propertyID, reservationID } = ids;
    const status = payload.status;

    logger.info(
      'CloudbedsWebhookService: Processing reservation/status_changed',
      { propertyID, reservationID, status },
    );

    // ─── Step 1: Early filter — only act on canceled ───
    if (status !== 'canceled') {
      logger.info(
        'CloudbedsWebhookService: Status transition not actionable, skipping',
        { propertyID, reservationID, status },
      );
      return {
        success: true,
        message: `Status transition to ${status} not actionable`,
      };
    }

    // ─── Step 2: Look up hotel by propertyID ───
    const hotel = await this.hotelService.getHotelByBusinessId(propertyID);
    if (!hotel) {
      logger.debug(
        'CloudbedsWebhookService: Unknown propertyID for status_changed, ignoring',
        { propertyID, reservationID, status },
      );
      return { success: true, message: 'Ignored: unknown property' };
    }

    // ─── Step 3: Find local reservation ───
    const localReservation = await this.syncService.findLocalReservation(
      hotel,
      reservationID,
    );

    if (!localReservation) {
      logger.info(
        'CloudbedsWebhookService: No local reservation for status_changed, skipping',
        { propertyID, reservationID, hotelId: hotel.id, status },
      );
      return {
        success: true,
        message: 'No local reservation found, skipped',
      };
    }

    // ─── Step 4: Only reservations created via Dextr are in scope ───
    if (!this.syncService.isDaisyOriginatedReservation(localReservation)) {
      logger.info(
        'CloudbedsWebhookService: Not a Dextr-originated reservation, skipping',
        { propertyID, reservationID, hotelId: hotel.id },
      );
      return {
        success: true,
        message: 'Not a Dextr-originated reservation, skipped',
      };
    }

    // ─── Step 5: Idempotency — skip if already in terminal status ───
    if (
      localReservation.status === ReservationStatus.CANCELLED ||
      localReservation.status === ReservationStatus.NO_SHOW
    ) {
      logger.info(
        'CloudbedsWebhookService: Reservation already in terminal status, skipping',
        {
          propertyID,
          reservationID,
          hotelId: hotel.id,
          localStatus: localReservation.status,
        },
      );
      return {
        success: true,
        message: `Reservation already ${localReservation.status}, skipped`,
      };
    }

    // ─── Step 6: Only currently-ACTIVE reservations can be cancelled ───
    if (localReservation.status !== ReservationStatus.ACTIVE) {
      logger.info(
        'CloudbedsWebhookService: Reservation is not ACTIVE, skipping',
        {
          propertyID,
          reservationID,
          hotelId: hotel.id,
          localStatus: localReservation.status,
        },
      );
      return {
        success: true,
        message: `Reservation is ${localReservation.status}, not cancellable, skipped`,
      };
    }

    // ─── Step 7: Cancel in Dextr via the same flow Dextr itself uses ───
    // CancellationSource.PMS skips the outbound call back to Cloudbeds (already
    // the source of truth) and the guest-facing eligibility check, while still
    // running KPI logging, the Telegram review-refund alert, guest SMS, and
    // payment-status handling.
    const { reservationCancelResult } =
      await this.roomReservationService.cancelReservation(
        localReservation.booking_id,
        CancellationSource.PMS,
        undefined,
        'Cancelled in Cloudbeds',
        hotel.id,
      );

    logger.info('CloudbedsWebhookService: Reservation cancelled in Dextr', {
      propertyID,
      reservationID,
      hotelId: hotel.id,
      reservationId: reservationCancelResult.id,
    });

    return {
      success: true,
      message: 'Reservation status updated to canceled',
      reservation_id: reservationCancelResult.id,
    };
  }

  /**
   * The decision tree for reservation modification events
   * (dates_changed, accommodation_type_changed):
   *
   * 1. Normalize field casing (propertyId → string, reservationId)
   * 2. Look up hotel by propertyID
   * 3. Resolve API credentials
   * 4. Fetch full reservation from Cloudbeds (getReservation)
   * 5. Find local reservation by external_id:
   *    - Not found → SKIP (out-of-order webhook or never tracked)
   *    - Found → UPDATE via syncUpdateReservation
   *
   * No thirdPartyIdentifier check: unlike reservation/created, modifications
   * made in the Cloudbeds UI should always sync — the PMS is the source of truth.
   *
   * No terminal-status guard: updating dates/room on a cancelled reservation
   * is harmless — status stays CANCELLED since Cloudbeds still reports "canceled".
   */
  private async handleReservationModified(
    payload: CloudbedsReservationModifiedPayload,
  ): Promise<CloudbedsWebhookResponse> {
    const event = payload.event;
    const ids = this.resolveIdentifiers(
      payload as unknown as Record<string, unknown>,
    );
    if (!ids) {
      logger.warn(
        `CloudbedsWebhookService: ${event} missing propertyId or reservationId`,
        { payload: JSON.stringify(payload) },
      );
      return { success: true, message: 'Missing required identifiers' };
    }
    const { propertyID, reservationID } = ids;

    logger.info(`CloudbedsWebhookService: Processing ${event}`, {
      propertyID,
      reservationID,
      event,
    });

    // ─── Step 1: Look up hotel by propertyID ───
    const hotel = await this.hotelService.getHotelByBusinessId(propertyID);
    if (!hotel) {
      logger.debug(
        `CloudbedsWebhookService: Unknown propertyID for ${event}, ignoring`,
        { propertyID, reservationID, event },
      );
      return { success: true, message: 'Ignored: unknown property' };
    }

    // ─── Step 2: Resolve API credentials ───
    const { apiToken } = await resolveCloudbedsCredentials(hotel);

    // ─── Step 3: Fetch full reservation details ───
    const fullReservation = await this.client.getReservation(
      { propertyID, reservationID },
      { apiToken, hotelId: hotel.id },
    );

    // ─── Step 4: Find local reservation ───
    const localReservation = await this.syncService.findLocalReservation(
      hotel,
      reservationID,
    );

    if (!localReservation) {
      logger.info(
        `CloudbedsWebhookService: No local reservation for ${event}, skipping`,
        { propertyID, reservationID, hotelId: hotel.id },
      );
      return {
        success: true,
        message: 'No local reservation found, skipped',
      };
    }

    // ─── Step 5: Update reservation with latest data from Cloudbeds ───
    const { reservationId } = await this.syncService.syncUpdateReservation(
      fullReservation,
      hotel,
      localReservation,
    );

    logger.info(`CloudbedsWebhookService: Reservation updated via ${event}`, {
      propertyID,
      reservationID,
      hotelId: hotel.id,
      reservationId,
    });

    return {
      success: true,
      message: `Reservation updated via ${event}`,
      reservation_id: reservationId,
    };
  }

  /**
   * The decision tree for integration/appstate_changed:
   *
   * 1. config.CLOUDBEDS_CLIENT_ID must be set — this event is the only one
   *    that needs to distinguish our app from others installed on the
   *    property (the rest key off propertyID alone), so a missing config
   *    value is a hard misconfiguration, not a thing to silently ignore
   * 2. Ignore if the payload's clientID doesn't match config.CLOUDBEDS_CLIENT_ID
   *    — Cloudbeds sends this event for any app installed on the property
   * 3. Ignore any newState other than 'disabled'/'enabled' — those are the
   *    only two transitions we act on
   * 4. Look up hotel by propertyID
   * 5. 'enabled' → just alert; ops still has to verify/re-auth the
   *    connection deliberately, so this webhook only raises visibility
   * 6. 'disabled' → set external_auth_config.disabledAt on
   *    hotel_configurations (this is what resolveCloudbedsCredentials
   *    checks, see cloudbedsCredentials.ts, so this genuinely blocks further
   *    Cloudbeds API access), then log + alert at error level
   *
   * Any error raised while processing (including a missing client ID config
   * or a failed Slack delivery) is reported to the shared ops alerts channel
   * and rethrown, so Cloudbeds still gets the existing 500/retry behavior on
   * top of the extra visibility.
   */
  private async handleAppStateChanged(
    payload: CloudbedsAppStateChangedPayload,
  ): Promise<CloudbedsWebhookResponse> {
    const propertyID = String(payload.propertyID_str ?? payload.propertyID);
    const { oldState, newState, clientID } = payload;

    logger.info(
      'CloudbedsWebhookService: Processing integration/appstate_changed',
      { propertyID, clientID, oldState, newState },
    );

    try {
      if (!config.CLOUDBEDS_CLIENT_ID) {
        throw new CloudbedsConfigurationError(
          'CloudbedsWebhookService: CLOUDBEDS_CLIENT_ID is not configured',
        );
      }

      if (clientID !== config.CLOUDBEDS_CLIENT_ID) {
        logger.debug(
          'CloudbedsWebhookService: appstate_changed clientID does not match ours, ignoring',
          { propertyID, clientID, oldState, newState },
        );
        return { success: true, message: 'Ignored: not our Cloudbeds app' };
      }

      if (newState !== 'disabled' && newState !== 'enabled') {
        logger.info(
          'CloudbedsWebhookService: appstate_changed newState not actionable, ignoring',
          { propertyID, clientID, oldState, newState },
        );
        return {
          success: true,
          message: `App state ${newState} not actionable, ignored`,
        };
      }

      const hotel = await this.hotelService.getHotelByBusinessId(propertyID);
      if (!hotel) {
        logger.debug(
          'CloudbedsWebhookService: Unknown propertyID for appstate_changed, ignoring',
          { propertyID, clientID, oldState, newState },
        );
        return { success: true, message: 'Ignored: unknown property' };
      }

      if (newState === 'enabled') {
        logger.info('CloudbedsWebhookService: Integration connected', {
          hotelId: hotel.id,
          hotelName: hotel.name,
          propertyID,
          clientID,
          oldState,
          newState,
        });

        await this.alertIntegrationEnabled(hotel, {
          propertyID,
          clientID,
          oldState,
          newState,
        });

        return { success: true, message: 'Integration connected' };
      }

      logger.error(
        'CloudbedsWebhookService: Integration disabled, blocking further Cloudbeds API access',
        {
          hotelId: hotel.id,
          hotelName: hotel.name,
          propertyID,
          clientID,
          oldState,
          newState,
        },
      );

      await this.hotelConfigurationService.setExternalAuthConfigDisabledAt(
        hotel.id,
        new Date(),
      );
      await this.alertIntegrationDisabled(hotel, {
        propertyID,
        clientID,
        oldState,
        newState,
      });

      return {
        success: true,
        message: 'Integration disabled, Cloudbeds API access blocked',
      };
    } catch (error) {
      logger.error(
        `CloudbedsWebhookService: Error processing integration/appstate_changed: ${error}`,
        { propertyID, clientID, oldState, newState },
      );
      await this.alertAppStateChangedProcessingError(error, {
        propertyID,
        clientID,
        oldState,
        newState,
      });
      throw error;
    }
  }

  /**
   * Posts a critical Slack alert (dedicated channel + mentions) when a
   * hotel's Cloudbeds integration is disabled. Delivery failures are not
   * swallowed here — they propagate to `handleAppStateChanged`'s catch block,
   * which reports them to the shared ops alerts channel instead.
   */
  private async alertIntegrationDisabled(
    hotel: { id: string; name: string },
    context: {
      propertyID: string;
      clientID: string;
      oldState: string;
      newState: string;
    },
  ): Promise<void> {
    const mentions = config.DEXTR_SLACK_ALERT_MENTION_USER_IDS.map(
      (userId: string) => `<@${userId}>`,
    ).join(' ');

    const lines = [
      ':rotating_light: *Cloudbeds integration disabled — API access blocked*',
      `> *Hotel*        ${hotel.name}`,
      `> *Hotel ID*     ${hotel.id}`,
      `> *Property ID*  ${context.propertyID}`,
      `> *Client ID*    ${context.clientID}`,
      `> *State*        ${context.oldState} → ${context.newState}`,
      mentions,
    ]
      .filter(Boolean)
      .join('\n');

    await this.slackService.sendMessage({
      recipient: config.DEXTR_SLACK_WEBHOOK_URL,
      content: { message: lines },
    });
  }

  /**
   * Posts a Slack alert (dedicated channel + mentions) when a hotel's
   * Cloudbeds integration is (re)connected, so ops can verify the connection
   * was raised by the expected property. Delivery failures are not swallowed
   * here — they propagate to `handleAppStateChanged`'s catch block, which
   * reports them to the shared ops alerts channel instead.
   */
  private async alertIntegrationEnabled(
    hotel: { id: string; name: string },
    context: {
      propertyID: string;
      clientID: string;
      oldState: string;
      newState: string;
    },
  ): Promise<void> {
    const mentions = config.DEXTR_SLACK_ALERT_MENTION_USER_IDS.map(
      (userId: string) => `<@${userId}>`,
    ).join(' ');

    const lines = [
      ':large_green_circle: *Cloudbeds integration connected*',
      `> *Hotel*        ${hotel.name}`,
      `> *Hotel ID*     ${hotel.id}`,
      `> *Property ID*  ${context.propertyID}`,
      `> *Client ID*    ${context.clientID}`,
      `> *State*        ${context.oldState} → ${context.newState}`,
      mentions,
    ]
      .filter(Boolean)
      .join('\n');

    await this.slackService.sendMessage({
      recipient: config.DEXTR_SLACK_WEBHOOK_URL,
      content: { message: lines },
    });
  }

  /**
   * Reports any error raised while processing integration/appstate_changed to
   * the shared ops alerts channel (SLACK_DAISY_ALERT_WEBHOOK_URL). Swallows
   * its own delivery failures — losing this alert must not mask the original
   * error being rethrown by the caller.
   */
  private async alertAppStateChangedProcessingError(
    error: unknown,
    context: {
      propertyID: string;
      clientID: string;
      oldState: string;
      newState: string;
    },
  ): Promise<void> {
    const lines = [
      ':rotating_light: *Error processing Cloudbeds integration/appstate_changed*',
      `> *Property ID*  ${context.propertyID}`,
      `> *Client ID*    ${context.clientID}`,
      `> *State*        ${context.oldState} → ${context.newState}`,
      `> *Error*        ${error instanceof Error ? error.message : String(error)}`,
    ].join('\n');

    try {
      await this.slackService.sendMessage({
        recipient: config.SLACK_DAISY_ALERT_WEBHOOK_URL,
        content: { message: lines },
      });
    } catch (slackError) {
      logger.error(
        `CloudbedsWebhookService: Failed to post processing-error Slack alert: ${slackError}`,
      );
    }
  }
  /**
   * Cloudbeds uses inconsistent casing across event types:
   *   - reservation/created, reservation/status_changed → propertyID, reservationID
   *   - reservation/dates_changed, accommodation_type_changed → propertyId, reservationId
   *
   * This helper normalizes both casings and returns null if either identifier
   * is missing, so handlers can return 400 instead of hitting the API with
   * undefined values.
   */
  private resolveIdentifiers(
    payload: Record<string, unknown>,
  ): { propertyID: string; reservationID: string } | null {
    const rawProperty =
      payload.propertyID_str ??
      payload.propertyId_str ??
      payload.propertyID ??
      payload.propertyId;
    const rawReservation = payload.reservationID ?? payload.reservationId;

    if (rawProperty == null || rawReservation == null) {
      return null;
    }

    return {
      propertyID: String(rawProperty),
      reservationID: String(rawReservation),
    };
  }
}

export const cloudbedsWebhookService = new CloudbedsWebhookService();
