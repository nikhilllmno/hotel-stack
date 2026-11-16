import { RequestHandler, Router } from 'express';
import { EmailController } from '../../controller/emailController';
import { emailService } from '../../services/email/emailService';

const emailController = new EmailController(emailService);

const emailRouter = Router();

emailRouter.post('/send', emailController.sendEmail as RequestHandler);
emailRouter.get('/templates', emailController.listTemplates as RequestHandler);

export default emailRouter;
