import { RequestHandler, Router } from 'express';
import { internalPmsTokenController } from '../controller/internal/internalPmsTokenController';
import { InternalRemoteLockController } from '../controller/internal/internalRemoteLockController';
import { InternalSessionController } from '../controller/internal/internalSessionController';
import SessionService from '../services/session/SessionService';

const internalRouter = Router();
const controller = new InternalSessionController(SessionService);
const remoteLockController = new InternalRemoteLockController();

// Routing-mode check (no body required), can be used from dashboard to check if the session is in DIRECT mode
internalRouter.get(
  '/sessions/routing',
  controller.getSessionRouting.bind(controller) as RequestHandler,
);

// Combined routing-check + message storage when mode is DIRECT, Calling from n8n
internalRouter.post(
  '/sessions/routing',
  controller.handleIncomingGuestMessage.bind(controller) as RequestHandler,
);

// RemoteLock access-person passthrough. Daisy holds the RemoteLock credential;
// callers (Alfred's webhook drain) hold the reservation and need only the raw
// access person, so `hotelId` in the path is the token-scoping key.
internalRouter.get(
  '/remotelock/hotels/:hotelId/access-persons/:accessPersonId',
  remoteLockController.getAccessPerson.bind(
    remoteLockController,
  ) as RequestHandler,
);

internalRouter.post(
  '/pms/token',
  internalPmsTokenController.storeToken.bind(
    internalPmsTokenController,
  ) as RequestHandler,
);

internalRouter.post(
  '/pms/client-credentials',
  internalPmsTokenController.storeClientCredentials.bind(
    internalPmsTokenController,
  ) as RequestHandler,
);

export default internalRouter;
