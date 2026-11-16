import { RequestHandler, Router } from 'express';
import { PmsProviderController } from '../../controller/pmsProviderController';
import { pmsProviderService } from '../../services/pmsProvider/pmsProviderService';

const pmsProviderController = new PmsProviderController(pmsProviderService);

const pmsProviderRouter = Router();

// PMS Provider routes
pmsProviderRouter.post(
  '/',
  pmsProviderController.createPmsProvider as RequestHandler,
);
pmsProviderRouter.get(
  '/',
  pmsProviderController.getAllPmsProviders as RequestHandler,
);
pmsProviderRouter.get(
  '/active',
  pmsProviderController.getActivePmsProviders as RequestHandler,
);
pmsProviderRouter.get(
  '/active',
  pmsProviderController.getActivePmsProviders as RequestHandler,
);
pmsProviderRouter.get(
  '/name/:name',
  pmsProviderController.getPmsProviderByName as RequestHandler,
);
pmsProviderRouter.get(
  '/:id',
  pmsProviderController.getPmsProviderById as RequestHandler,
);
pmsProviderRouter.put(
  '/:id',
  pmsProviderController.updatePmsProvider as RequestHandler,
);
pmsProviderRouter.post(
  '/:id/activate',
  pmsProviderController.activatePmsProvider as RequestHandler,
);
pmsProviderRouter.post(
  '/:id/deactivate',
  pmsProviderController.deactivatePmsProvider as RequestHandler,
);

export default pmsProviderRouter;
