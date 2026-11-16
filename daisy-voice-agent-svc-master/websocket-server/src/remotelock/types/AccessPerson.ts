import { AccessPersonStatus, RemoteLockResource } from './common';

/**
 * `access_guest` — a temporary access person with a start/end window.
 * `starts_at`/`ends_at` carry no timezone; the lock's configured timezone
 * applies. See docs 04-access-persons.
 */
export interface AccessGuestAttributes {
  name: string;
  email: string | null;
  phone: string | null;
  status: AccessPersonStatus;
  starts_at: string;
  ends_at: string;
  pin: string | null;
  department: string | null;
  created_at?: string;
  updated_at?: string;
}

export type AccessGuest = RemoteLockResource<
  'access_guest',
  AccessGuestAttributes
>;

/** Query parameters for `GET /access_persons`. */
export interface GetAccessPersonsParams {
  type?: 'access_user' | 'access_guest';
  status?: AccessPersonStatus[];
  sort?: string;
  page?: number;
  per_page?: number;
}
