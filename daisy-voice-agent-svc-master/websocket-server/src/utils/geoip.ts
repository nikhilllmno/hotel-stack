/**
 * Derive approximate location from client IP using GeoIP (MaxMind data).
 * Returns null for private IPs (e.g. 192.168.x.x) and when lookup fails.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const geoip = require('geoip-lite');

interface GeoIPResult {
  country?: string;
  region?: string;
  city?: string;
  ll?: [number | null, number | null];
}

function isPrivateIp(ip: string): boolean {
  return (
    /^127\./.test(ip) ||
    /^10\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    ip === '::1' ||
    ip.startsWith('::ffff:127.') ||
    ip.startsWith('::ffff:10.') ||
    ip.startsWith('::ffff:192.168.') ||
    ip.startsWith('::ffff:172.')
  );
}

/**
 * Get a location string from an IP address (approximate, from GeoIP database).
 * Prefers "lat,lng" when available; otherwise "city, region, country".
 * For private/local IPs returns null.
 */
export function getLocationFromIp(ip: string | undefined): string | null {
  if (!ip || typeof ip !== 'string') return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;

  let lookupIp = trimmed;
  if (trimmed.startsWith('::ffff:')) {
    lookupIp = trimmed.slice(7);
  }

  if (isPrivateIp(lookupIp)) return null;

  const geo: GeoIPResult | null = geoip.lookup(lookupIp);
  if (!geo) return null;

  const [lat, lng] = geo.ll ?? [null, null];
  if (lat != null && lng != null) {
    return `${lat},${lng}`;
  }

  const parts = [geo.city, geo.region, geo.country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}
