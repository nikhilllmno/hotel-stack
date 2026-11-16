/**
 * Shared response envelope used by Cloudbeds' v1.3 endpoints.
 *
 * Successful responses include `success: true` and the endpoint-specific
 * payload under `data`. Failure responses include `success: false` plus a
 * `message` and optional `errorCode`. The client wraps failure envelopes
 * into `CloudbedsAPIError` so callers never see them directly.
 */
export interface CloudbedsApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  errorCode?: string | number;
  count?: number;
  total?: number;
}
