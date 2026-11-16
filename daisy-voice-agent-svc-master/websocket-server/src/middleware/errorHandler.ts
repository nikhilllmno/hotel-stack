import { ErrorRequestHandler, RequestHandler } from 'express';
import { BaseError } from '../errors/BaseError';
import logger from '../utils/logger';
import { getRequestContext } from '../utils/requestContext';

// Respond directly for unmatched routes — skip the error pipeline so bot/scanner
// traffic and typos don't get logged at error level via BaseError's constructor.
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    message: `Route ${req.method} ${req.originalUrl} not found`,
    statusCode: 404,
  });
};

export const globalErrorHandler: ErrorRequestHandler = (
  err,
  _req,
  res,
  next,
) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof BaseError) {
    res.status(err.statusCode).json(err.toJSON());
    return;
  }

  logger.error('Unhandled error', {
    error: err,
    requestId: getRequestContext()?.requestId,
  });

  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({
    message: 'Internal Server Error',
    statusCode: 500,
    ...(isProd ? {} : { stack: (err as Error)?.stack }),
  });
};
