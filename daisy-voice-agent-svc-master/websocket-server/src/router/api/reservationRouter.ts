import { RequestHandler, Router } from 'express';
import { ProtectedReservationController } from '../../controller/protected/protectedReservationController';
import roomReservationService from '../../services/roomReservation/roomReservationService';

const reservationRouter = Router();
const controller = new ProtectedReservationController(roomReservationService);

reservationRouter.get(
  '/summary',
  controller.getReservationDashboardSummary.bind(controller) as RequestHandler,
);

reservationRouter.get(
  '/',
  controller.getHotelReservationList.bind(controller) as RequestHandler,
);

reservationRouter.get(
  '/:booking_id',
  controller.getReservationByBookingId.bind(controller) as RequestHandler,
);

reservationRouter.get(
  '/:booking_id/summary',
  controller.getConversationSummaryByBookingId.bind(
    controller,
  ) as RequestHandler,
);

reservationRouter.get(
  '/:booking_id/transcripts',
  controller.getTranscriptsByBookingId.bind(controller) as RequestHandler,
);

reservationRouter.post(
  '/:booking_id/mark-payment-collected',
  controller.markPaymentCollected.bind(controller) as RequestHandler,
);

reservationRouter.patch(
  '/:booking_id/auto-charge',
  controller.setupAutoCharge.bind(controller) as RequestHandler,
);

reservationRouter.post(
  '/:booking_id/charge',
  controller.chargeReservationImmediately.bind(controller) as RequestHandler,
);

reservationRouter.get(
  '/:booking_id/payment-summary',
  controller.getBookingPaymentSummary.bind(controller) as RequestHandler,
);

reservationRouter.post(
  '/:booking_id/refund',
  controller.processBookingRefund.bind(controller) as RequestHandler,
);

reservationRouter.patch(
  '/:booking_id/status',
  controller.updateReservationStatus.bind(controller) as RequestHandler,
);

reservationRouter.get(
  '/:externalId/payments',
  controller.getPaymentsByExternalId as RequestHandler,
);

export default reservationRouter;
