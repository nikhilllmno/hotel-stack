import logger from './logger';

/**
 * Opt-in decorator/helper that logs function input arguments at debug level.
 *
 * Usage as a method decorator:
 * ```
 * class MyService {
 *   @logArgs
 *   async myMethod(arg1: string, arg2: number) { ... }
 * }
 * ```
 *
 * Usage as a function wrapper:
 * ```
 * const wrappedFn = withLogArgs('myFunction', myFunction);
 * ```
 */
export function logArgs(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor,
): PropertyDescriptor {
  const originalMethod = descriptor.value;
  const className = target.constructor?.name || 'Unknown';

  descriptor.value = function (...args: any[]) {
    logger.debug(`Entering ${className}.${propertyKey}`, {
      args: sanitizeArgs(args),
    });
    return originalMethod.apply(this, args);
  };

  return descriptor;
}

/**
 * Wrap a standalone function with argument logging at debug level.
 */
export function withLogArgs<T extends (...args: any[]) => any>(
  name: string,
  fn: T,
): T {
  const wrapped = function (this: any, ...args: any[]) {
    logger.debug(`Entering ${name}`, {
      args: sanitizeArgs(args),
    });
    return fn.apply(this, args);
  };
  return wrapped as T;
}

/**
 * Sanitize arguments for logging — truncate large objects, skip functions.
 */
function sanitizeArgs(args: any[]): any[] {
  return args.map((arg) => {
    if (typeof arg === 'function') return '[Function]';
    if (arg === undefined) return 'undefined';
    if (arg === null) return null;
    try {
      const str = JSON.stringify(arg);
      if (str && str.length > 1024) {
        return str.substring(0, 1024) + '...[truncated]';
      }
      return arg;
    } catch {
      return String(arg);
    }
  });
}
