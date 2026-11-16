import { isAxiosError } from 'axios';
import path from 'path';
import winston from 'winston';
import config from '../config';
import { getRequestContext } from './requestContext';

/**
 * Known internal class/function name fragments from Winston and Node.js internals
 * that should be skipped when walking the stack for caller info.
 */
const STACK_SKIP_PATTERNS = [
  // File-path-based skips
  'logger.ts',
  'logger.js',
  'requestContext.ts',
  'requestContext.js',
  'node_modules',
  // Node.js built-in module frames (appear as "node:events", "node:_http_outgoing", etc.)
  'node:',
  // HTTP client interceptors — caller is always the interceptor itself (useless for async responses)
  'httpClient.ts',
  'httpClient.js',
  // Winston class/function name skips (covers cases where path doesn't contain node_modules,
  // e.g. symlinked installs, pnpm, yarn PnP)
  'DerivedLogger',
  'Logger.write',
  'Logger.log',
  'Transform._transform',
  'Transform._flush',
  'Writable.write',
  'Writable._write',
  'winston',
];

function shouldSkipFrame(line: string): boolean {
  return STACK_SKIP_PATTERNS.some((p) => line.includes(p));
}

/**
 * Extract caller info string from the current call stack.
 * Returns "ClassName.methodName" or "filename.functionName" for the first
 * application-code frame outside the logger and Winston internals.
 *
 * NOTE: Winston's stream pipeline consumes ~9 stack frames before reaching
 * application code. We temporarily raise Error.stackTraceLimit to 20 so that
 * the app-code frame is visible. The limit is restored immediately after.
 *
 * NOTE: contextFormat is intentionally applied ONLY at the logger level (not
 * the transport level). Applying it at both levels would cause the second run
 * to overwrite info.context using a deeper async stack where the app-code
 * frame is no longer reachable.
 */
function extractCaller(): string | undefined {
  const saved = Error.stackTraceLimit;
  Error.stackTraceLimit = 20;
  const err = new Error();
  Error.stackTraceLimit = saved;

  const lines = (err.stack || '').split('\n');

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (shouldSkipFrame(line)) continue;

    // Pattern: "at ClassName.method (/path/to/file.ts:line:col)"
    const namedMatch = line.match(/^at\s+(?:new\s+)?([\w$.]+)\s+\(/);
    if (namedMatch) {
      let caller = namedMatch[1];
      // Discard generic wrappers
      if (caller === 'Object' || caller === 'Function' || caller === '')
        continue;

      // If it's a plain function name (no dot), prepend the file name for context
      if (!caller.includes('.')) {
        const fileMatch = line.match(/\((.+?):\d+:\d+\)/);
        if (fileMatch) {
          const fileName = path
            .basename(fileMatch[1])
            .replace(/\.(ts|js)x?$/, '');
          caller = `${fileName}.${caller}`;
        }
      }
      return caller;
    }

    // Fallback: anonymous frame — just return the file:line
    const anonMatch =
      line.match(/\((.+?):(\d+):\d+\)/) || line.match(/^at\s+(.+?):(\d+):\d+$/);
    if (anonMatch) {
      return `${path.basename(anonMatch[1]).replace(/\.(ts|js)x?$/, '')}:${anonMatch[2]}`;
    }
  }

  return undefined;
}

/**
 * Custom Winston format that injects request context and caller metadata
 * into every log entry under a single `context` key.
 *
 * Applied ONLY at the logger level so it runs once with the correct call stack.
 */
const contextFormat = winston.format((info) => {
  const requestContext = getRequestContext();
  const caller = extractCaller();

  const ctx: Record<string, string | undefined> = {};

  if (requestContext?.requestId) ctx.requestId = requestContext.requestId;
  if (requestContext?.customerPhone)
    ctx.customerPhone = requestContext.customerPhone;
  if (requestContext?.assistantPhoneNumber)
    ctx.assistantPhoneNumber = requestContext.assistantPhoneNumber;
  if (requestContext?.hotelId) ctx.hotelId = requestContext.hotelId;
  if (caller) ctx.caller = caller;

  if (Object.keys(ctx).length > 0) {
    info.context = ctx;
  }

  return info;
});

/**
 * Axios errors carry the full request (`config.data`) and response, which can
 * hold card numbers and credentials. Winston copies an Error's own fields into
 * the log entry, so strip them wherever an axios error ends up.
 */
function summarizeAxiosError(error: unknown) {
  if (!isAxiosError(error)) return error;
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    status: error.response?.status,
  };
}

// Only arrays and plain objects are walked; class instances and Dates keep their own serialization.
function redactNestedAxiosErrors(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (isAxiosError(value)) return summarizeAxiosError(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactNestedAxiosErrors(item, seen));
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      redactNestedAxiosErrors(item, seen),
    ]),
  );
}

const redactAxiosErrorFormat = winston.format((info) => {
  if (isAxiosError(info) || (info as { isAxiosError?: boolean }).isAxiosError) {
    const response = info.response as { status?: number } | undefined;
    if (response?.status !== undefined) info.status = response.status;
    delete info.config;
    delete info.request;
    delete info.response;
  }
  for (const [key, value] of Object.entries(info)) {
    info[key] = redactNestedAxiosErrors(value);
  }
  return info;
});

const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  // contextFormat applied ONCE here — transport-level format must not re-run it
  format: winston.format.combine(
    redactAxiosErrorFormat(),
    winston.format.timestamp(),
    contextFormat(),
  ),
  transports: [
    new winston.transports.Console({
      // Only serialise to JSON; context already injected by logger-level format above
      format: winston.format.json(),
    }),
  ],
});

export default logger;
