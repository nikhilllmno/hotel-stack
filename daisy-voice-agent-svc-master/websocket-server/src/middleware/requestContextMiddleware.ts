import { NextFunction, Request, Response } from 'express';
import { createRequestContext, runWithContext } from '../utils/requestContext';

/**
 * Middleware that establishes an AsyncLocalStorage request context.
 * Generates a UUID v4 requestId, or uses the incoming x-request-id header.
 * Must be registered before requestLogger and route handlers.
 */
export const requestContextMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const incomingRequestId = req.headers['x-request-id'] as string | undefined;
  const context = createRequestContext(incomingRequestId);

  // Also attach to req for easy access in middleware that needs it directly
  (req as any).requestId = context.requestId;

  // Set the x-request-id response header for traceability
  res.setHeader('x-request-id', context.requestId);

  runWithContext(context, () => {
    next();
  });
};
