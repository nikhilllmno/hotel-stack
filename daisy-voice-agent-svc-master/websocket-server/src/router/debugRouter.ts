import { Router } from 'express';
import { DebugController } from '../controller/debugController';

const debugRouter = Router();
const debugController = new DebugController();

debugRouter.get(
  '/conversations',
  debugController.queryConversations.bind(debugController),
);
debugRouter.get('/hotels', debugController.getHotels.bind(debugController));
debugRouter.post(
  '/admin-update-hotel-phone',
  debugController.adminUpdateHotelPhone.bind(debugController),
);

export default debugRouter;
