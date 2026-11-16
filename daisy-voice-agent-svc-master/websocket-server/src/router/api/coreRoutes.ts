import { Router } from 'express';
import escalationRouter from './escalationRouter';
import hotelRouter from './hotelRoute';
import paymentRouter from './paymentRouter';
import reservationRouter from './reservationRouter';
import sessionRouter from './sessionRouter';

const coreRouter = Router();

coreRouter.use('/hotel', hotelRouter);
coreRouter.use('/sessions', sessionRouter);
coreRouter.use('/escalations', escalationRouter);
coreRouter.use('/reservations', reservationRouter);
coreRouter.use('/payments', paymentRouter);

export default coreRouter;
