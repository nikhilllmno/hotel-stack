import { Request, RequestHandler } from 'express';
import { createHash } from 'node:crypto';
import config from '../config';
import { getDeviceIpAndLocation } from '../utils/ipUtils';
import { KpiStat, logKpi } from '../utils/kpiLogger';
import logger from '../utils/logger';

/**
 * Middleware to validate the x-api-key header against the inbound key lists.
 * Keys in DAISY_INBOUND_API_KEYS are accepted silently. Keys in
 * DAISY_INBOUND_API_KEYS_EXPIRED are still accepted but logged as a warning,
 * so callers that need rotating can be identified before the key is dropped.
 * Missing/invalid keys are rejected and logged with request metadata.
 */
export const apiKeyMiddleware: RequestHandler = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const activeKeys = config.DAISY_INBOUND_API_KEYS;

  if (activeKeys.length === 0) {
    res.status(500).json({ error: 'DAISY_INBOUND_API_KEYS is not configured' });
    return;
  }

  if (!apiKey) {
    rejectApiKey(req);
    res.status(401).json({ error: 'Missing x-api-key header' });
    return;
  }

  if (typeof apiKey === 'string' && activeKeys.includes(apiKey)) {
    next();
    return;
  }

  if (
    typeof apiKey === 'string' &&
    config.DAISY_INBOUND_API_KEYS_EXPIRED.includes(apiKey)
  ) {
    logger.warn(
      `Expired x-api-key accepted (fingerprint ${fingerprintApiKey(apiKey)}) ${stringifyRequestMeta(req)}`,
    );
    logKpi({
      stat: KpiStat.AuthApiKeyExpiredAccepted,
      value: 1,
      contextName: 'apiKeyMiddleware',
      contextId: requestRoute(req),
    });
    next();
    return;
  }

  rejectApiKey(req);
  res.status(403).json({ error: 'Invalid API key' });
};

/**
 * Logs a request whose x-api-key header is missing or invalid, with enough
 * request metadata to identify the caller. Kept as a standalone function (not
 * middleware) so it can be reused wherever this visibility is needed.
 */
export function logMissingOrInvalidApiKey(req: Request): void {
  const apiKey = req.headers['x-api-key'];
  let message = 'Request missing x-api-key header';
  if (apiKey) {
    message =
      typeof apiKey === 'string'
        ? `Request has invalid x-api-key header (fingerprint ${fingerprintApiKey(apiKey)})`
        : 'Request has invalid x-api-key header';
  }

  logger.error(`${message} ${stringifyRequestMeta(req)}`);
}

function rejectApiKey(req: Request): void {
  logMissingOrInvalidApiKey(req);
  logKpi({
    stat: KpiStat.AuthApiKeyRejected,
    value: 1,
    contextName: 'apiKeyMiddleware',
    contextId: requestRoute(req),
  });
}

/**
 * Identifies which key a caller used without logging any of its characters,
 * which a suffix would do in full for short keys.
 */
function fingerprintApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 8);
}

function requestRoute(req: Request): string {
  return `${req.baseUrl}${req.path}`;
}

function stringifyRequestMeta(req: Request): string {
  const { customer_device_ip } = getDeviceIpAndLocation(req);
  const userAgentHeader = req.headers['user-agent'];

  return JSON.stringify({
    method: req.method,
    route: requestRoute(req),
    ip: customer_device_ip,
    userAgent: Array.isArray(userAgentHeader)
      ? userAgentHeader[0]
      : userAgentHeader,
  });
}
