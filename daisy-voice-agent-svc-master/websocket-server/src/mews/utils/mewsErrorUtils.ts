/**
 * Extracts the Mews API RequestId attached to an error by the shared
 * httpClient response interceptor (see utils/httpClient.ts). Mews support
 * asks for this value when investigating failed requests.
 */
export function getMewsRequestId(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as { providerRequestId?: unknown }).providerRequestId;
  return typeof value === 'string' ? value : undefined;
}
