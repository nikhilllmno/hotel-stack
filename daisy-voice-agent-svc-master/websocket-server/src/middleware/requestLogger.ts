import { NextFunction, Request, Response } from 'express';
import logger from '../utils/logger';
import { getRequestContext } from '../utils/requestContext';

const MAX_BODY_LOG_LENGTH = 2048;

// List of URL patterns to exclude from logging
const EXCLUDED_URLS: (string | RegExp)[] = [
  '/health',
  '/public-url',
  '/favicon.ico',
];

// Endpoints whose request body carries card data. The body is replaced rather
// than truncated: a 2048-char truncation would still include a PAN.
const SENSITIVE_BODY_URLS: (string | RegExp)[] = [
  /\/opera\/card-token/i,
  /\/reservation\/card\b/i,
  /\/shift4\/card-token/i,
  /\/mews\/card-token/i,
  /\/cloudbeds\/card-token/i,
  /\/authorizenet\/card-token/i,
];

function hasSensitiveBody(url: string): boolean {
  return SENSITIVE_BODY_URLS.some((pattern) =>
    typeof pattern === 'string' ? url === pattern : pattern.test(url),
  );
}

function isExcluded(url: string): boolean {
  return EXCLUDED_URLS.some((pattern) => {
    if (typeof pattern === 'string') {
      return url === pattern;
    } else if (pattern instanceof RegExp) {
      return pattern.test(url);
    }
    return false;
  });
}

function truncateBody(body: any): string | undefined {
  if (body === undefined || body === null) return undefined;
  try {
    const str = typeof body === 'string' ? body : JSON.stringify(body);
    if (str.length > MAX_BODY_LOG_LENGTH) {
      return str.substring(0, MAX_BODY_LOG_LENGTH) + '...[truncated]';
    }
    return str;
  } catch {
    return '[unserializable]';
  }
}

export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (isExcluded(req.url)) {
    return next();
  }

  const context = getRequestContext();
  const requestId = context?.requestId || (req as any).requestId || 'unknown';
  const startTime = Date.now();

  logger.info('Incoming Request', {
    requestId,
    method: req.method,
    url: req.url,
    params: Object.keys(req.query).length ? req.query : undefined,
    body: hasSensitiveBody(req.url) ? '[REDACTED]' : truncateBody(req.body),
    host: req.hostname,
    ip: req.ip,
    protocol: req.protocol,
  });

  // Intercept res.json and res.send to capture the response body before it is flushed.
  // By the time res.on('finish') fires the socket is already drained, so we must
  // capture the body here and stash it on the response object.
  let responseBody: string | undefined;

  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    responseBody = truncateBody(body);
    return originalJson(body);
  };

  const originalSend = res.send.bind(res);
  res.send = (body: any) => {
    // Only capture if res.json hasn't already set it (to avoid double capture)
    if (responseBody === undefined) {
      responseBody = truncateBody(body);
    }
    return originalSend(body);
  };

  // Log the completed response with timing and captured body
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    logger.info('Outgoing Response', {
      requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime,
      body: responseBody,
    });
  });

  next();
};
