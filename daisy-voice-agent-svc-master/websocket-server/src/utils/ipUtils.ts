import { getLocationFromIp } from './geoip';

/**
 * Normalize IP for storage: strip IPv4-mapped prefix (::ffff:) so that
 * e.g. ::ffff:192.168.65.1 → 192.168.65.1
 */
export function normalizeIpForStorage(
  ip: string | undefined,
): string | undefined {
  if (!ip || typeof ip !== 'string') return undefined;
  const trimmed = ip.trim();
  if (trimmed.startsWith('::ffff:')) return trimmed.slice(7);
  return trimmed;
}

/** Request-like object with the fields needed to resolve client IP and user-agent */
export interface RequestLikeForIp {
  headers: { [key: string]: string | string[] | undefined };
  ip?: string;
  socket?: { remoteAddress?: string };
}

/**
 * Parse User-Agent for a simple browser name and device type.
 */
function parseUserAgent(ua: string): {
  browser?: string;
  device_type?: string;
} {
  if (!ua || typeof ua !== 'string') return {};
  const result: { browser?: string; device_type?: string } = {};
  const s = ua.toLowerCase();
  if (s.includes('edg/')) result.browser = 'Edge';
  else if (s.includes('chrome')) result.browser = 'Chrome';
  else if (s.includes('safari') && !s.includes('chrome'))
    result.browser = 'Safari';
  else if (s.includes('firefox')) result.browser = 'Firefox';
  else if (s.includes('opera') || s.includes('opr/')) result.browser = 'Opera';
  else if (s.includes('msie') || s.includes('trident')) result.browser = 'IE';
  if (
    s.includes('mobile') ||
    s.includes('android') ||
    s.includes('iphone') ||
    s.includes('ipad')
  ) {
    result.device_type = 'Mobile';
  } else if (s.includes('bot') || s.includes('crawler')) {
    result.device_type = 'Bot';
  } else {
    result.device_type = 'Desktop';
  }
  return result;
}

export interface DeviceIpAndLocation {
  rawIp: string | undefined;
  customer_device_ip: string | undefined;
  customer_device_location: string | undefined;
  browser: string | undefined;
  device_type: string | undefined;
}

/**
 * Get raw IP, normalized device IP, location (x-device-location header if present, else GeoIP), and device info (browser, device_type from User-Agent) from request.
 */
export function getDeviceIpAndLocation(
  req: RequestLikeForIp,
): DeviceIpAndLocation {
  const rawIp =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.ip ||
    (req.socket?.remoteAddress as string) ||
    undefined;
  const customer_device_ip = normalizeIpForStorage(rawIp);
  const headerLocation = (req.headers['x-device-location'] as string)?.trim();
  const customer_device_location =
    headerLocation || (getLocationFromIp(rawIp) ?? undefined);

  const userAgentRaw =
    (req.headers['user-agent'] as string)?.trim() || undefined;
  const { browser, device_type } = userAgentRaw
    ? parseUserAgent(userAgentRaw)
    : {};

  return {
    rawIp,
    customer_device_ip,
    customer_device_location,
    browser,
    device_type,
  };
}
