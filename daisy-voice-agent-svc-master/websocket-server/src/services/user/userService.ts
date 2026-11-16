import { DuplicateUserError } from '../../errors/AuthErrors';
import { BadRequestError } from '../../errors/BadRequestError';
import { User, UserRole } from '../../models/User';
import { UserRepository } from '../../repositories/UserRepository';
import { hashPassword } from '../../utils/hash';
import logger from '../../utils/logger';

// Type for User without password
type UserWithoutPassword = Omit<User, 'password'>;

export interface CreateUserDto {
  username: string;
  password: string;
  role: UserRole;
  creatorRole: UserRole;
  hotel_id?: string;
}

export class UserService {
  private userRepository: UserRepository;

  constructor(userRepository: UserRepository = new UserRepository()) {
    this.userRepository = userRepository;
  }

  async createUser(params: CreateUserDto): Promise<UserWithoutPassword> {
    if (params.creatorRole !== UserRole.SUPERADMIN) {
      throw new BadRequestError(
        'createUser:: You do not have the access to perform this action',
      );
    }

    const existingUser = await this.userRepository.findByUsername(
      params.username,
    );
    if (existingUser) {
      const errMsg = `createUser:: Username already exists: ${params.username}`;
      logger.error(errMsg);
      throw new DuplicateUserError(params.username);
    }

    if (params.role !== UserRole.SUPERADMIN && !params.hotel_id) {
      const errMsg = `createUser:: hotel_id is required for creating a user with role ${params.role}. Only ${UserRole.SUPERADMIN} can be created without hotel_id.`;
      logger.error(errMsg);
      throw new BadRequestError(errMsg);
    }

    const hashedPassword = await hashPassword(params.password);

    const user = await this.userRepository.create({
      username: params.username,
      password: hashedPassword,
      role: params.role,
      ...(params.hotel_id && { hotel_id: params.hotel_id }),
    });

    return user;
  }

  async getUserById(id: string): Promise<UserWithoutPassword | null> {
    return this.userRepository.findById(id);
  }

  async getUserByUsername(username: string): Promise<UserWithoutPassword> {
    return this.userRepository.findByUsername(username);
  }

  async getUserAndPasswordByUsername(username: string): Promise<User> {
    return this.userRepository.getUserAndPasswordByUsername(username);
  }

  async getUsers(): Promise<UserWithoutPassword[]> {
    return this.userRepository.findAll();
  }

  async updateUser(
    id: string,
    data: Partial<CreateUserDto>,
  ): Promise<UserWithoutPassword | null> {
    if (data.creatorRole !== UserRole.SUPERADMIN) {
      throw new BadRequestError(
        'createUser:: You do not have the access to perform this action',
      );
    }
    return this.userRepository.update(id, data);
  }

  async deleteUser(
    id: string,
    actionPerformerRole: UserRole,
  ): Promise<boolean> {
    if (actionPerformerRole !== UserRole.SUPERADMIN) {
      throw new BadRequestError(
        'createUser:: You do not have the access to perform this action',
      );
    }
    return this.userRepository.delete(id);
  }

  async getUsersByHotelId(hotel_id: string): Promise<UserWithoutPassword[]> {
    return this.userRepository.findByHotelId(hotel_id);
  }
}

export const userService = new UserService();
export default userService;
