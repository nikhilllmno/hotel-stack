import { RemoteLockResource } from './common';

/** See docs 05-users, `GET /user`. */
export interface UserAttributes {
  name: string;
  email: string;
  handle: string;
  created_at: string;
  updated_at: string;
  primary_account_id: string;
  default_account_id: string;
}

export type RemoteLockUser = RemoteLockResource<'user', UserAttributes>;
