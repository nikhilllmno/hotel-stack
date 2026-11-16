// routes/notificationRouter.ts

// TODO: This is an old file. The guest-checkin-summary should be moved to scheduledJobsRouter.ts. The current path also uses a hacky way to resolve circular dependencies. Instead of that, a proper mechanism should be implemented.

import { Router } from 'express';
import { NotificationController } from '../controller/notificationController';
import guestCheckinSummaryService from '../services/guestCheckinSummaryService/GuestCheckinSummaryService';
import roomReservationService from '../services/roomReservation/roomReservationService';

// Resolve circular dependency by setting the guestCheckinSummaryService in roomReservationService
roomReservationService.setGuestCheckinSummaryService(
  guestCheckinSummaryService,
);

// Create the notification controller with the guestCheckinSummaryService
// The controller will initialize the notificationService in guestCheckinSummaryService
const notificationController = new NotificationController(
  guestCheckinSummaryService,
);

const router = Router();

router.post(
  '/guest-checkin-summary',
  notificationController.sendGuestCheckinSummary,
);
const notificationRouter = router;

export default notificationRouter;
