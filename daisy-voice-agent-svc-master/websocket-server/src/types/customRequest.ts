import 'express';
import { Request } from 'express';
import { UserRole } from '../models/User';

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: UserRole;
  hotel_id?: string;
}

export interface AuthenticatedRequest<
  T = any,
  P = any,
  B = any,
  L = any,
> extends Request<T, P, B, L> {
  user?: AuthenticatedUser;
}

export {};
