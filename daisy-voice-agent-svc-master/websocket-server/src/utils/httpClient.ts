import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from 'axios';
import { PmsProvider } from '../types/enums';
import { KpiStat, logKpi } from './kpiLogger';
import logger from './logger';
import { getRequestContext } from './requestContext';

/** Headers whose values should be redacted in logs */
const REDACTED_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'token',
]);

/**
 * `createHttpClient` names that front a PMS integration. Calls made through
 * these instances emit a generic `pms.api.call` KPI so every provider gets
 * the same raw-API-level signal without a per-endpoint stat per provider.
 */
const PMS_HTTP_CLIENT_NAMES = new Set<string>(Object.values(PmsProvider));

/**
 * Some PMS APIs (Cloudbeds, Calry) answer a 200 with an envelope carrying
 * `success: false` on failure; Hostaway uses `status: 'fail'`. Axios treats
 * these as successful responses, so the response interceptor below would
 * otherwise log `pms.api.call` instead of `pms.api.call_error` for them.
 * Duck-typed on purpose — this only inspects the shape, not a provider's
 * own response types, so it applies uniformly across clients.
 */
function isSoftFailureBody(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const body = data as Record<string, unknown>;
  return body.success === false || body.status === 'fail';
}

/** Default max body length to log (in characters) */
const DEFAULT_MAX_BODY_LOG_LENGTH = 1024;

interface HttpClientOptions extends AxiosRequestConfig {
  /** Maximum body length to include in logs (default: 1024) */
  maxBodyLogLength?: number;
  /** Applied to request and response bodies before they are logged. */
  redactBody?: (body: unknown) => unknown;
}

/**
 * Redact sensitive header values for logging.
 */
function sanitizeHeaders(
  headers: Record<string, any> | undefined,
): Record<string, any> {
  if (!headers) return {};
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (REDACTED_HEADERS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Axios hands interceptors an already serialized body in some paths (a caller
 * passing a JSON string, or a text response), so it is parsed to reach the same
 * redaction. A string that is not JSON cannot be redacted, so a client with a
 * redactor does not log it.
 */
function redactStringBody(
  body: string,
  redactBody: ((value: unknown) => unknown) | undefined,
): string {
  if (!redactBody) return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return '[non-JSON body not logged]';
  }
  return JSON.stringify(redactBody(parsed));
}

/**
 * Truncate a body value for logging.
 */
function truncateBody(
  body: any,
  maxLength: number,
  redactBody: ((value: unknown) => unknown) | undefined,
): string | undefined {
  if (body === undefined || body === null) return undefined;
  try {
    const str =
      typeof body === 'string'
        ? redactStringBody(body, redactBody)
        : JSON.stringify(redactBody ? redactBody(body) : body);
    if (str.length > maxLength) {
      return str.substring(0, maxLength) + '...[truncated]';
    }
    return str;
  } catch {
    return '[unserializable]';
  }
}

/**
 * Create a named HTTP client (axios instance) with standardized logging interceptors.
 *
 * Features:
 * - Logs all outgoing requests and responses
 * - Redacts sensitive headers (Authorization, x-api-key, cookie, token)
 * - Truncates body summaries
 * - Injects x-request-id from AsyncLocalStorage context
 * - Tracks response duration
 *
 * @param name - Client name used as prefix in log entries (e.g., "alfred", "telegram")
 * @param options - Axios config plus optional maxBodyLogLength
 */
export function createHttpClient(
  name: string,
  options: HttpClientOptions = {},
): AxiosInstance {
  const {
    maxBodyLogLength = DEFAULT_MAX_BODY_LOG_LENGTH,
    redactBody,
    ...axiosConfig
  } = options;
  const instance = axios.create(axiosConfig);

  // Request interceptor
  instance.interceptors.request.use(
    (reqConfig: InternalAxiosRequestConfig) => {
      // Inject x-request-id from context
      const context = getRequestContext();
      if (context?.requestId) {
        reqConfig.headers.set('x-request-id', context.requestId);
      }

      // Record start time for duration calculation
      (reqConfig as any)._startTime = Date.now();

      logger.info(`${name} Request`, {
        client: name,
        method: reqConfig.method?.toUpperCase(),
        url: `${reqConfig.baseURL || ''}${reqConfig.url || ''}`,
        params: reqConfig.params,
        headers: sanitizeHeaders(
          reqConfig.headers?.toJSON?.() || (reqConfig.headers as any),
        ),
        body: truncateBody(reqConfig.data, maxBodyLogLength, redactBody),
      });

      return reqConfig;
    },
    (error) => {
      logger.error(`${name} Request Error`, {
        client: name,
        message: error.message,
      });
      return Promise.reject(error);
    },
  );

  // Response interceptor
  instance.interceptors.response.use(
    (response) => {
      const duration =
        Date.now() - ((response.config as any)._startTime || Date.now());
      logger.info(`${name} Response`, {
        client: name,
        status: response.status,
        url: `${response.config.baseURL || ''}${response.config.url || ''}`,
        duration,
        headers: sanitizeHeaders(response.headers as any),
        body: truncateBody(response.data, maxBodyLogLength, redactBody),
      });
      if (PMS_HTTP_CLIENT_NAMES.has(name)) {
        const isSoftFailure = isSoftFailureBody(response.data);
        logKpi({
          stat: isSoftFailure ? KpiStat.PmsApiCallError : KpiStat.PmsApiCall,
          value: 1,
          contextName: 'createHttpClient',
        });
      }
      return response;
    },
    (error) => {
      const duration = error.config?._startTime
        ? Date.now() - error.config._startTime
        : undefined;

      if (PMS_HTTP_CLIENT_NAMES.has(name)) {
        logKpi({
          stat: KpiStat.PmsApiCallError,
          value: 1,
          contextName: 'createHttpClient',
        });
      }

      // Some providers (Mews) include a RequestId in failed response
      // bodies that support asks for when investigating issues. Undefined for providers that don't return one.
      const providerRequestId =
        error.response?.data && typeof error.response.data === 'object'
          ? (error.response.data as Record<string, unknown>).RequestId
          : undefined;

      if (providerRequestId !== undefined) {
        error.providerRequestId = providerRequestId;
      }

      logger.error(`${name} Response Error`, {
        client: name,
        status: error.response?.status,
        message: error.message,
        url: error.config
          ? `${error.config.baseURL || ''}${error.config.url || ''}`
          : undefined,
        duration,
        ...(providerRequestId !== undefined ? { providerRequestId } : {}),
      });
      return Promise.reject(error);
    },
  );

  return instance;
}
