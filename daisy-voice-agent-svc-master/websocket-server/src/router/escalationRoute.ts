import { RequestHandler, Router } from 'express';
import { EscalationController } from '../controller/escalationController';
import {
  setSessionData,
  validatePhoneNumber,
} from '../middleware/validatePhoneNumberAndSetSession';
import escalationService from '../services/escalation/escalationService';

const router = Router();
router.use(validatePhoneNumber);
router.use(setSessionData);

const escalationController = new EscalationController(escalationService);

router.post('/', escalationController.createEscalation as RequestHandler);

export default router;
