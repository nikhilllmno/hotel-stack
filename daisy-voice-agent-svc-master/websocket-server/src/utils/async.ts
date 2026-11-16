/**
 * Runs asyncFn with a time limit. Returns fallback when the limit is exceeded.
 * Errors thrown by asyncFn are still propagated to the caller.
 */
export async function withTimeoutWithFallback<T>(
  asyncFn: () => Promise<T>,
  maxDurationMs: number,
  fallback: T,
  onTimeout?: () => void,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => {
      onTimeout?.();
      resolve(fallback);
    }, maxDurationMs);
  });

  try {
    return await Promise.race([asyncFn(), timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
