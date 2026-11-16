import { Router } from 'express';
import { WellKnownController } from '../controller/wellKnownController';

const wellKnownRouter = Router();
const wellKnownController = new WellKnownController();

wellKnownRouter.get('/jwks.json', wellKnownController.getJwks);

export default wellKnownRouter;
