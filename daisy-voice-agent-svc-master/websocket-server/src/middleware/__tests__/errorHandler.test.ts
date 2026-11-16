import type { NextFunction, Request, Response } from 'express';
import { BaseError } from '../../errors/BaseError';
import logger from '../../utils/logger';
import { getRequestContext } from '../../utils/requestContext';
import { globalErrorHandler, notFoundHandler } from '../errorHandler';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../utils/requestContext', () => ({
  __esModule: true,
  getRequestContext: jest.fn(),
}));

const mockedLogger = logger as jest.Mocked<typeof logger>;
const mockedGetRequestContext = getRequestContext as jest.MockedFunction<
  typeof getRequestContext
>;

// Minimal Express req/res/next doubles. res.status/json are chainable and record calls.
function createResponse() {
  const res = {} as Response & {
    statusCode?: number;
    body?: unknown;
    headersSent: boolean;
  };
  res.headersSent = false;
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response['status'];
  res.json = jest.fn((payload: unknown) => {
    res.body = payload;
    return res;
  }) as unknown as Response['json'];
  return res;
}

describe('globalErrorHandler', () => {
  const req = {} as Request;
  let res: ReturnType<typeof createResponse>;
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    res = createResponse();
    next = jest.fn();
    mockedGetRequestContext.mockReturnValue(undefined);
    jest.clearAllMocks();
  });

  describe('when a response has already started', () => {
    it('delegates to next(err) and does not write a second response', () => {
      res.headersSent = true;
      const err = new Error('too late');

      globalErrorHandler(err, req, res, next);

      expect(next).toHaveBeenCalledWith(err);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('when the error is a BaseError (expected/operational)', () => {
    it('responds with the error status code and its JSON body', () => {
      const err = new BaseError('bad input'); // statusCode defaults to 400

      globalErrorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        message: 'bad input',
        statusCode: 400,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('does not log it as an unhandled error', () => {
      const err = new BaseError('bad input');

      globalErrorHandler(err, req, res, next);

      expect(mockedLogger.error).not.toHaveBeenCalledWith(
        'Unhandled error',
        expect.anything(),
      );
    });
  });

  describe('when the error is unexpected (not a BaseError)', () => {
    it('responds with 500 and a generic message', () => {
      const err = new Error('kaboom');

      globalErrorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Internal Server Error',
          statusCode: 500,
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('logs the error with the requestId from the request context', () => {
      mockedGetRequestContext.mockReturnValue({
        requestId: 'req-123',
      } as ReturnType<typeof getRequestContext>);
      const err = new Error('kaboom');

      globalErrorHandler(err, req, res, next);

      expect(mockedLogger.error).toHaveBeenCalledWith('Unhandled error', {
        error: err,
        requestId: 'req-123',
      });
    });

    it('includes the stack trace when not in production', () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const err = new Error('kaboom');

      globalErrorHandler(err, req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ stack: err.stack }),
      );
      process.env.NODE_ENV = prev;
    });

    it('omits the stack trace in production', () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const err = new Error('kaboom');

      globalErrorHandler(err, req, res, next);

      const payload = (res.json as jest.Mock).mock.calls[0][0];
      expect(payload).not.toHaveProperty('stack');
      process.env.NODE_ENV = prev;
    });

    it('does not throw when the thrown value is not an Error (e.g. a string)', () => {
      const err = 'a plain string' as unknown as Error;

      expect(() => globalErrorHandler(err, req, res, next)).not.toThrow();
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});

describe('notFoundHandler', () => {
  it('responds with 404 and the requested method and URL', () => {
    const req = {
      method: 'GET',
      originalUrl: '/nope',
    } as Request;
    const res = createResponse();

    notFoundHandler(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Route GET /nope not found',
      statusCode: 404,
    });
  });
});
