import { Request, Response, Router } from 'express';
import clientLogService, {
  ClientLogPayload,
  LogLevel,
} from '../services/logging/clientLogService';

const router = Router();

const LEVEL_HANDLERS: Record<LogLevel, (payload: ClientLogPayload) => void> = {
  error: (payload) => clientLogService.logError(payload),
  warn: (payload) => clientLogService.logWarn(payload),
  info: (payload) => clientLogService.logInfo(payload),
};

router.post('/', (req: Request, res: Response) => {
  const { level, ...payload } = req.body || {};

  const handler = LEVEL_HANDLERS[level as LogLevel];
  if (!handler) {
    res
      .status(400)
      .json({ error: 'Invalid level. Must be one of: error, warn, info' });
    return;
  }

  handler(payload);
  res.status(200).json({ ok: true });
});

export default router;
