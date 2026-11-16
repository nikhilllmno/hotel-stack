import { RequestHandler, Router } from 'express';
import { PaymentController } from '../../controller/paymentController';
import paymentService from '../../services/payment/paymentService';

const paymentController = new PaymentController(paymentService);

const paymentRouter = Router();

// Payment routes
paymentRouter.get('/:id', paymentController.getPaymentById as RequestHandler);

export default paymentRouter;
