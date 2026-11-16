/**
 * True when Core JWT claims.permissions includes "admin" (system admin).
 * @example
 * coreClaimsIncludeAdmin({ permissions: ['admin'] }) => true
 * coreClaimsIncludeAdmin({ permissions: ['read'] }) => false
 */
export function coreClaimsIncludeAdmin(
  claims: Record<string, unknown>,
): boolean {
  const permissions = claims.permissions;
  return Array.isArray(permissions) && permissions.includes('admin');
}
