import { Router } from 'express';
import oauthController from '../controller/oauthController';

const router = Router();

router.get('/:provider/connect', oauthController.connect.bind(oauthController));

router.get(
  '/:provider/callback',
  oauthController.callback.bind(oauthController),
);

export default router;
