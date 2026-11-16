import crypto from 'crypto';

/**
 * Generates a signed api-key for the Cloudbeds Payment Element web component.
 *
 * Signing formula (from Cloudbeds docs):
 *   message  = "{identity}|{propertyId}"
 *   hmac     = HMAC-SHA256(message, secret)
 *   apiKey   = "{identity}.{base64(hmac)}"
 */
export function generateSdkApiKey(
  identity: string,
  secret: string,
  propertyId: string,
): string {
  const message = `${identity}|${propertyId}`;
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('base64');
  return `${identity}.${hmac}`;
}
