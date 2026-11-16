import { json, Router } from 'express';
import { vapiOutboundController } from '../controller/vapiOutboundController';

const vapiOutboundRouter = Router();
vapiOutboundRouter.use(json());

vapiOutboundRouter.post(
  '/outbound-call',
  vapiOutboundController.createOutboundCall.bind(vapiOutboundController),
);

export default vapiOutboundRouter;
