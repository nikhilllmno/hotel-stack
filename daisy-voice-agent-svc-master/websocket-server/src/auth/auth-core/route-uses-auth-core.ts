/**
 * True when this request should attempt Core JWKS auth.
 * Method is ignored — any HTTP method on an allowlisted path is onboarded.
 * @example
 * routeUsesAuthCore({ method: 'GET', path: '/hotel/abc/configuration' }) => true
 * routeUsesAuthCore({ method: 'GET', path: '/sessions/summary' }) => true
 */
export function routeUsesAuthCore(args: {
  method: string;
  path: string;
  originalUrl?: string;
}): boolean {
  if (pathMatchesAllowlist(args.path)) {
    return true;
  }

  if (args.originalUrl != null && args.originalUrl !== '') {
    const pathOnly = args.originalUrl.split('?')[0] ?? '';
    if (pathMatchesAllowlist(pathOnly)) {
      return true;
    }
  }

  return routeUsesTokenScopedHotelAuth(args);
}

/**
 * True when hotel scope comes from the Core JWT (businessEnts), not the URL.
 * @example
 * routeUsesTokenScopedHotelAuth({ path: '/sessions/summary' }) => true
 * routeUsesTokenScopedHotelAuth({ path: '/hotel/abc/configuration' }) => false
 */
export function routeUsesTokenScopedHotelAuth(args: {
  path: string;
  originalUrl?: string;
}): boolean {
  if (pathMatchesTokenScopedPrefix(args.path)) {
    return true;
  }

  if (args.originalUrl != null && args.originalUrl !== '') {
    const pathOnly = args.originalUrl.split('?')[0] ?? '';
    return pathMatchesTokenScopedPrefix(pathOnly);
  }

  return false;
}

/** Glob patterns; `*` matches one path segment. Optional `/api` prefix is stripped before match. */
const AUTH_CORE_PATH_ALLOWLIST = [
  // Hotel scope comes from the URL: `businessEnts` must name the hotel being addressed.
  '/hotel',
  '/hotel/*',
  '/hotel/*/configuration',
  // Superadmin-only, no hotel in the URL — reachable only via `permissions: ["admin"]`.
  // Literal patterns: segment counts differ from the hotel patterns above, so `*` cannot cover them.
  '/hotel/recordings/backfill',
  '/hotel/recordings/backfill/conversation',
] as const;

/** Routes that read hotel scope from the JWT rather than the URL. */
const AUTH_CORE_TOKEN_SCOPED_PREFIXES = [
  '/sessions',
  '/escalations',
  '/reservations',
  '/payments',
] as const;

function pathMatchesAllowlist(path: string): boolean {
  const normalized = normalizePath(path);
  return AUTH_CORE_PATH_ALLOWLIST.some((pattern) =>
    matchPathPattern(normalized, pattern),
  );
}

function pathMatchesTokenScopedPrefix(path: string): boolean {
  const normalized = normalizePath(path);
  return AUTH_CORE_TOKEN_SCOPED_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

function normalizePath(path: string): string {
  let normalized = path.startsWith('/') ? path : `/${path}`;
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  if (normalized.startsWith('/api/')) {
    normalized = normalized.slice(4);
  }
  return normalized;
}

function matchPathPattern(path: string, pattern: string): boolean {
  const pathParts = path.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (pathParts.length !== patternParts.length) {
    return false;
  }
  return patternParts.every(
    (part, index) => part === '*' || part === pathParts[index],
  );
}
