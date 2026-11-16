import { Response } from 'express';
import { BaseError } from '../../errors/BaseError';
import { NoDataError } from '../../errors/NoDataError';
import { NoContextError } from '../../errors/vapi/NoContextError';

export const handleAgentErrorAndSendResponse = (
  error: unknown,
  res: Response,
) => {
  if (error instanceof NoDataError) {
    const noContext = new NoContextError(error.message);
    res.status(noContext.statusCode).send(noContext.toJSON());
    return;
  }

  if (error instanceof BaseError) {
    res.status(error.statusCode).json(error.toJSON());
    return;
  }

  res.status(500).json({
    message: 'Internal Server error',
    statusCode: 500,
  });

  return;
};

export const handleCoreApiErrorAndSendResponse = (
  error: unknown,
  res: Response,
) => {
  if (error instanceof BaseError) {
    res.status(error.statusCode).json(error.toJSON());
    return;
  }

  res.status(500).json({
    message: 'Internal Server error',
    statusCode: 500,
  });

  return;
};
