/**
 * Per-hotel Cloudbeds Payments SDK credentials stored in
 * `hotel_configurations.external_auth_config` under the `cloudbedsPaymentSdk` key.
 * `secret` is AES-256-GCM encrypted at rest; `identity` is public.
 */
export interface CloudbedsPaymentSdkConfig {
  identity: string;
  secret: string;
  issuedAt: string;
}
