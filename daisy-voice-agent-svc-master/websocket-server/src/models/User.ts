export interface User {
  id: string;
  username: string;
  password: string; // hashed
  role: UserRole;
  hotel_id?: string; // optional only for superadmin
  created_at: Date;
  updated_at: Date;
}

export enum UserRole {
  SUPERADMIN = 'superadmin',
  ADMIN = 'admin',
  USER = 'user',
  NO_ACCESS = 'no_access',
}
