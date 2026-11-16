/**
 * Promise coalescing ("single-flight"): concurrent callers await the **same** in-flight `Promise`.
 * Waiters do **not** queue a second run when the first finishes—they join the run already in progress.
 *
 * @example
 * // Two overlapping calls: `expensive()` runs once; both receive 42.
 * const sf = createSingleFlightRunner();
 * const a = sf.run(() => expensive());
 * const b = sf.run(() => expensive());
 * await Promise.all([a, b]); // => [42, 42], expensive invoked once
 */

export type SingleFlightRunner = {
  /**
   * Runs `fn` once if nothing is in flight; concurrent callers await the same promise.
   * If already in flight, `fn` is not invoked again — callers receive the first run’s outcome.
   */
  run<T>(fn: () => Promise<T>): Promise<T>;
};

export type KeyedSingleFlightRunner = {
  /**
   * Per `key`: runs `fn` once while that key is in flight; concurrent callers for the same key share one promise.
   * Different keys do not block each other.
   */
  run<T>(key: string, fn: () => Promise<T>): Promise<T>;
};

/**
 * The shared promise is only awaited by concurrent waiters. With none, a
 * failed run would be reported as an unhandled rejection even though the
 * first caller handled it; waiters still receive the rejection.
 */
function ignoreRejection(promise: Promise<unknown>): void {
  promise.catch(() => undefined);
}

/**
 * Creates a runner that coalesces concurrent async work into one shared promise per invocation slot.
 */
export function createSingleFlightRunner(): SingleFlightRunner {
  let inflight: Promise<unknown> | undefined;
  const result: SingleFlightRunner = {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const existing = inflight;
      if (existing !== undefined) {
        return existing as Promise<T>;
      }
      const p = fn();
      inflight = p.finally(() => {
        inflight = undefined;
      });
      ignoreRejection(inflight);
      return p;
    },
  };
  return result;
}

/**
 * Creates a runner that coalesces concurrent async work **per string key** (independent slots per key).
 */
export function createKeyedSingleFlightRunner(): KeyedSingleFlightRunner {
  const inflightByKey = new Map<string, Promise<unknown>>();
  const result: KeyedSingleFlightRunner = {
    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = inflightByKey.get(key);
      if (existing !== undefined) {
        return existing as Promise<T>;
      }
      const p = fn();
      const tracked = p.finally(() => {
        inflightByKey.delete(key);
      });
      ignoreRejection(tracked);
      inflightByKey.set(key, tracked);
      return p;
    },
  };
  return result;
}
