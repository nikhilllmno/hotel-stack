import { json, Router } from 'express';
import webRoomReservationController from '../controller/webRoomReservationController';

const router = Router();
const controller = webRoomReservationController();
router.use(json());

router.get(
  '/availability',
  controller.getWebRoomAvailabilityInfo.bind(controller),
);

router.get('/rate-calendar', controller.getRateCalendar.bind(controller));

router.post('/checkout', controller.createWebReservation.bind(controller));

export default router;
