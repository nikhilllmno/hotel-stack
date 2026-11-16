/**
 * The one execution lane. Commands change one Chrome, so only one runs at a time, across every bridge connection:
 * a reconnect must not let a command of the old connection overlap the first command of the new one. The chain is
 * module-level state and is never reset; work that went stale while it waited checks that itself and does nothing.
 */

let tail: Promise<unknown> = Promise.resolve();

export function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(work);
  tail = run.catch(() => undefined);  // a failed command must not block the ones behind it
  return run;
}

/** Test hook: forget the chain, so a test that left work hanging does not block the next one. */
export function resetLaneForTest(): void {
  tail = Promise.resolve();
}
