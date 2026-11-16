import { json, Router } from 'express';
import { SessionController } from '../controller/sessionController';
import { apiKeyMiddleware } from '../middleware/apiKeyMiddleware';
import { validatePhoneNumber } from '../middleware/validatePhoneNumberAndSetSession';
import ConversationService from '../services/conversation/ConversationService';
import SessionService from '../services/session/SessionService';

const sessionRouter = Router();
const controller = new SessionController(SessionService, ConversationService);
sessionRouter.use(json());

// API-key protected cron endpoint
sessionRouter.post(
  '/analytics-summary',
  apiKeyMiddleware,
  controller.sendAnalyticsSummary.bind(controller),
);

// Each call's summary is sent to the hotel's Telegram channel. It includes the audio recording as well. When they click on the recording, this endpoint will be accessed. It's only via Telegram and doesn't need authentication.
sessionRouter.get(
  '/:sessionId/conversations/recording',
  controller.streamRecordingBySessionId.bind(controller),
);

sessionRouter.use(validatePhoneNumber);

sessionRouter.get('/', controller.getLatestActiveSession.bind(controller));
sessionRouter.post('/', controller.createSession.bind(controller));
sessionRouter.put('/', controller.updateSession.bind(controller));

export default sessionRouter;
