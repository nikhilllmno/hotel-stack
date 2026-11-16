import { Router } from 'express';
import remoteLockOAuthController from '../controller/remoteLockOAuthController';

const router = Router();

router.get(
  '/callback',
  remoteLockOAuthController.callback.bind(remoteLockOAuthController),
);

export default router;
