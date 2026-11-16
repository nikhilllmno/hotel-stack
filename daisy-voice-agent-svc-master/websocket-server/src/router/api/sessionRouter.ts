import { RequestHandler, Router } from 'express';
import { ProtectedSessionController } from '../../controller/protected/protectedSessionController';
import SessionService from '../../services/session/SessionService';

const sessionRouter = Router();

const controller = new ProtectedSessionController(SessionService);

sessionRouter.get(
  '/',
  controller.getPaginatedSessions.bind(controller) as RequestHandler,
);
sessionRouter.get(
  '/summary',
  controller.getCallDashboardSummary.bind(controller) as RequestHandler,
);
sessionRouter.get(
  '/intents',
  controller.getConversationIntentSummary.bind(controller) as RequestHandler,
);
sessionRouter.get(
  '/kpis/trend',
  controller.getKpiTrend.bind(controller) as RequestHandler,
);
sessionRouter.get(
  '/kpis',
  controller.getCallKpiSummary.bind(controller) as RequestHandler,
);

// SMS operator inbox (hotel_id from JWT; must be before /:session_id)
sessionRouter.get(
  '/sms-sessions',
  controller.listSmsInboxSessions.bind(controller) as RequestHandler,
);
sessionRouter.get(
  '/sms-sessions/:sessionId/messages',
  controller.listSmsInboxMessages.bind(controller) as RequestHandler,
);
sessionRouter.post(
  '/sms-sessions/:sessionId/messages',
  controller.sendSmsInboxMessage.bind(controller) as RequestHandler,
);
sessionRouter.post(
  '/sms-sessions/:sessionId/read',
  controller.markSmsInboxSessionRead.bind(controller) as RequestHandler,
);

sessionRouter.get(
  '/:session_id/reservations',
  controller.getReservationsList.bind(controller) as RequestHandler,
);
sessionRouter.get(
  '/:session_id/escalations',
  controller.getEscalationsList.bind(controller) as RequestHandler,
);
sessionRouter.get(
  '/:session_id/conversations',
  controller.getConversationSummary.bind(controller) as RequestHandler,
);
sessionRouter.get(
  '/:session_id/conversations/transcripts',
  controller.getConversationTranscript.bind(controller) as RequestHandler,
);

export default sessionRouter;
