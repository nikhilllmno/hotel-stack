import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID as uuidv4 } from 'node:crypto';

export interface RequestContextData {
  requestId: string;
  customerPhone?: string;
  assistantPhoneNumber?: string;
  hotelId?: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContextData>();

/**
 * Get the current request context from AsyncLocalStorage.
 * Returns undefined if called outside a request context.
 */
export function getRequestContext(): RequestContextData | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Update the current request context with partial data.
 * Merges provided fields into the existing context store.
 * No-op if called outside a request context.
 */
export function setRequestContext(partial: Partial<RequestContextData>): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    Object.assign(store, partial);
  }
}

/**
 * Run a function within a new request context.
 * Used by middleware to establish the context scope for a request.
 */
export function runWithContext<T>(store: RequestContextData, fn: () => T): T {
  return asyncLocalStorage.run(store, fn);
}

/**
 * Generate a new request context data object.
 * Uses the provided requestId or generates a UUID v4.
 */
export function createRequestContext(requestId?: string): RequestContextData {
  return {
    requestId: requestId || uuidv4(),
  };
}

export default asyncLocalStorage;
