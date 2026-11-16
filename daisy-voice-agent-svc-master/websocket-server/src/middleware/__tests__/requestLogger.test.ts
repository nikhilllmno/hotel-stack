const mockLoggerInfo = jest.fn();

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { requestLogger } from '@/middleware/requestLogger';
import { NextFunction, Request, Response } from 'express';

const PAN = '4111111111111111';

function runMiddleware(url: string, body: unknown) {
  const req = { url, method: 'POST', query: {}, body } as unknown as Request;
  const res = {
    json: jest.fn(),
    send: jest.fn(),
    on: jest.fn(),
  } as unknown as Response;

  requestLogger(req, res, jest.fn() as unknown as NextFunction);
}

describe('requestLogger', () => {
  beforeEach(() => mockLoggerInfo.mockReset());

  it('redacts the body of the Opera card endpoint', () => {
    runMiddleware('/opera/card-token', {
      reservation_review_id: 'REV-1',
      pan: PAN,
      expiryDate: '2612',
    });

    expect(mockLoggerInfo.mock.calls[0][1].body).toBe('[REDACTED]');
    expect(JSON.stringify(mockLoggerInfo.mock.calls)).not.toContain(PAN);
  });

  it('redacts the body of the ResNexus card endpoint', () => {
    runMiddleware('/daisy/reservation/card', {
      reservation_review_id: 'REV-1',
      pan: PAN,
      cvv: '737',
      expiry_month: 12,
      expiry_year: 2030,
    });

    expect(mockLoggerInfo.mock.calls[0][1].body).toBe('[REDACTED]');
    expect(JSON.stringify(mockLoggerInfo.mock.calls)).not.toContain(PAN);
  });

  it('redacts regardless of path casing', () => {
    runMiddleware('/daisy/Opera/Card-Token', { pan: PAN });

    expect(mockLoggerInfo.mock.calls[0][1].body).toBe('[REDACTED]');
    expect(JSON.stringify(mockLoggerInfo.mock.calls)).not.toContain(PAN);
  });

  it('still logs bodies for other routes', () => {
    runMiddleware('/reservations/lookup', {
      reservation_review_id: 'REV-1',
      transactionId: 'txn-1',
    });

    expect(mockLoggerInfo.mock.calls[0][1].body).toContain('txn-1');
  });

  it('redacts the body of the Mews card endpoint', () => {
    runMiddleware('/mews/card-token', { pan: PAN });

    expect(mockLoggerInfo.mock.calls[0][1].body).toBe('[REDACTED]');
    expect(JSON.stringify(mockLoggerInfo.mock.calls)).not.toContain(PAN);
  });

  it('redacts the body of the Cloudbeds card endpoint', () => {
    runMiddleware('/cloudbeds/card-token', { pan: PAN });

    expect(mockLoggerInfo.mock.calls[0][1].body).toBe('[REDACTED]');
    expect(JSON.stringify(mockLoggerInfo.mock.calls)).not.toContain(PAN);
  });

  it('redacts the body of the AuthorizeNet card endpoint', () => {
    runMiddleware('/authorizenet/card-token', { pan: PAN });

    expect(mockLoggerInfo.mock.calls[0][1].body).toBe('[REDACTED]');
    expect(JSON.stringify(mockLoggerInfo.mock.calls)).not.toContain(PAN);
  });
});
