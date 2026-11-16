/**
 * RemoteLock Connect API v1 shared response envelope.
 *
 * All responses have a `data` root key. Collections add a `meta` object for
 * pagination. See docs 03-conventions.
 */

export interface RemoteLockPagination {
  page: number;
  per_page: number;
  total_pages: number;
  total_count: number;
}

/** Single-resource envelope: `{ data: <resource> }`. */
export interface RemoteLockResourceEnvelope<T> {
  data: T;
}

/** Collection envelope: `{ data: [...], meta: {...} }`. */
export interface RemoteLockCollectionEnvelope<T> {
  data: T[];
  meta: RemoteLockPagination;
}

/** A RemoteLock JSON:API resource object. */
export interface RemoteLockResource<TType extends string, TAttributes> {
  id: string;
  type: TType;
  attributes: TAttributes;
  links?: Record<string, string>;
  meta?: Record<string, unknown>;
}

export type AccessPersonStatus =
  | 'current'
  | 'upcoming'
  | 'expired'
  | 'deactivated';
