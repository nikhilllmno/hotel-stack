import { RequestHandler, Router } from 'express';
import { ProtectedEscalationController } from '../../controller/protected/protectedEscalationController';
import escalationService from '../../services/escalation/escalationService';

const escalationRouter = Router();
const controller = new ProtectedEscalationController(escalationService);
escalationRouter.get(
  '/',
  controller.getEscalationList.bind(controller) as RequestHandler,
);
escalationRouter.get(
  '/:id',
  controller.getEscalationById.bind(controller) as RequestHandler,
);
escalationRouter.get(
  '/phone/:phone_number',
  controller.getEscalationByPhone.bind(controller) as RequestHandler,
);
escalationRouter.patch(
  '/:id',
  controller.updateEscalation.bind(controller) as RequestHandler,
);
escalationRouter.delete(
  '/:id',
  controller.deleteEscalation.bind(controller) as RequestHandler,
);

export default escalationRouter;
