import { json, Router } from 'express';
import roomReservationController from '../controller/roomReservationController';
import { apiKeyMiddleware } from '../middleware/apiKeyMiddleware';
import {
  setSessionData,
  validatePhoneNumber,
} from '../middleware/validatePhoneNumberAndSetSession';

const router = Router();
const controller = roomReservationController();
router.use(json());

//------------------------------------------------------------------------------------------------
// All APIs in this section are invoked via lambdas and should have API key validation

router.post(
  '/stale-reservations/cancel',
  apiKeyMiddleware,
  controller.cancelStaleReservationsAndPayments.bind(controller),
);

router.post(
  '/payment-reminders',
  apiKeyMiddleware,
  controller.sendPaymentReminders.bind(controller),
);

router.post(
  '/discounts/cleanup-expired',
  apiKeyMiddleware,
  controller.cleanupExpiredDiscounts.bind(controller),
);

router.post(
  '/payment-links/disable-unavailable',
  apiKeyMiddleware,
  controller.cancelReservationsForUnavailableRooms.bind(controller),
);

router.post(
  '/onboarding-sms',
  apiKeyMiddleware,
  controller.sendOnboardingSms.bind(controller),
);

/**
 * POST /process-auto-charges
 *
 * Charges due auto-charges for all payment providers (Shift4, Mews)
 * concurrently. Called by Lambda/EventBridge on its own schedule.
 */
router.post(
  '/process-auto-charges',
  apiKeyMiddleware,
  controller.processAutoCharges.bind(controller),
);

// TODO: remove once the Shift4 Lambda/EventBridge trigger is repointed to
// /process-auto-charges (external infra config, not in this repo).
router.post(
  '/process-shift4-auto-charges',
  apiKeyMiddleware,
  controller.processAutoCharges.bind(controller),
);
//------------------------------------------------------------------------------------------------

//------------------------------------------------------------------------------------------
// The endpoints here are customer-facing endpoints and shouldn't have API key validation
// API key is sensitive and shouldn't be exposed to the customers.

router.patch(
  '/reservation/review',
  controller.submitReviewAndProcessReservation.bind(controller),
);

router.get(
  '/reservation/review',
  controller.getReservationDetailsByReviewId.bind(controller),
);

router.post(
  '/shift4/card-token',
  controller.submitShift4CardTokenAndCreateReservations.bind(controller),
);

router.post(
  '/mews/card-token',
  controller.submitMewsCardTokenAndCreateReservations.bind(controller),
);

router.post(
  '/cloudbeds/card-token',
  controller.submitCloudbedsCardTokenAndCreateReservations.bind(controller),
);

router.post(
  '/authorizenet/card-token',
  controller.submitAuthorizeNetCardTokenAndCreateReservations.bind(controller),
);

router.post(
  '/opera/card-token',
  controller.submitOperaCardTokenAndCreateReservations.bind(controller),
);

router.post(
  '/reservation/card',
  controller.submitResNexusCardAndCreateReservations.bind(controller),
);

// All endpoints below require phone validation and API key validation
router.use(validatePhoneNumber);
router.use(setSessionData);
router.use(apiKeyMiddleware);

router.post('/rooms', controller.getUnitGroups.bind(controller));
router.post(
  '/discount',
  controller.getActiveDiscountByPhoneNumbers.bind(controller),
);
router.post(
  '/availability',
  controller.switchAvailabilityBasedOnBody.bind(controller),
);
// Returns escalation instruction: callback vs call-forwarding message based on current time in hotel timezone
router.post(
  '/escalation-instruction',
  controller.getEscalationInstruction.bind(controller),
);
router.post(
  '/availability-lite',
  controller.switchAvailabilityBasedOnBodyLite.bind(controller),
);
// Cloudbeds-only: same as /availability-lite, but sources availability via
// getAvailableRoomTypes instead of getRoomTypes, working around a Cloudbeds
// bug affecting same-day check-ins.
router.post(
  '/availability-lite-v2',
  controller.switchAvailabilityBasedOnBodyLiteV2.bind(controller),
);
router.post(
  '/room-type-rates',
  controller.getAllRatesForRoomType.bind(controller),
);
router.post(
  '/sister-property-availability',
  controller.checkSisterPropertyAvailability.bind(controller),
);
router.post(
  '/booking-link-sms',
  controller.sendBookingLinkSMS.bind(controller),
);
router.post('/send-sms', controller.sendSMS.bind(controller));
router.post(
  '/reservation/status',
  controller.getReservationStatusInWords.bind(controller),
);
router.post('/reservation/door-code', controller.getDoorCode.bind(controller));
// Late-arrival lockbox code from the hotel's own lockbox log (door_lock_config.lockbox_log).
router.post('/lockbox-code', controller.getLockboxCode.bind(controller));
router.post(
  '/reservation',
  controller.switchReservationBasedOnAction.bind(controller),
);
router.post(
  '/multi-availability',
  controller.switchMultiRoomAvailabilityBasedOnBody.bind(controller),
);
router.post(
  '/multi-availability-lite',
  controller.switchMultiRoomAvailabilityBasedOnBodyLite.bind(controller),
);
// Cloudbeds-only: same as /multi-availability-lite, but sources availability
// via getAvailableRoomTypes instead of getRoomTypes, working around a
// Cloudbeds bug affecting same-day check-ins.
router.post(
  '/multi-availability-lite-v2',
  controller.switchMultiRoomAvailabilityBasedOnBodyLiteV2.bind(controller),
);
router.post(
  '/multi-reservation',
  controller.switchMultiRoomReservationBasedOnAction.bind(controller),
);
export default router;
