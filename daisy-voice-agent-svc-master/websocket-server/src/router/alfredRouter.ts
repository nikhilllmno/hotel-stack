import { json, Router } from 'express';
import { AlfredController } from '../controller/alfredController';
import { validatePhoneNumber } from '../middleware/validatePhoneNumberAndSetSession';
import alfredService from '../services/alfred/alfredService';

const alfredRouter = Router();
const controller = new AlfredController(alfredService);

alfredRouter.use(json());
alfredRouter.use(validatePhoneNumber);

// POST /alfred/door-code
alfredRouter.post(
  '/door-code',
  controller.getDoorCodeByExternalPartner.bind(controller),
);

// POST /alfred/reservation-details
alfredRouter.post(
  '/reservation-details',
  controller.getReservationDetailsByExternalPartner.bind(controller),
);

// PATCH /alfred/customers/phone-number
alfredRouter.patch(
  '/customers/phone-number',
  controller.updateCustomerPhoneNumber.bind(controller),
);

export default alfredRouter;
