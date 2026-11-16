import { User, UserRole } from '../models/User';

export interface LoginDto {
  username: string;
  password: string;
}

export interface LoginResponseDto {
  authToken: string;
  user: Omit<User, 'id' | 'created_at' | 'updated_at' | 'password'>;
}

export interface SignupDto {
  username: string;
  password: string;
  role: UserRole;
  creatorRole: UserRole;
  hotel_id?: string;
}
