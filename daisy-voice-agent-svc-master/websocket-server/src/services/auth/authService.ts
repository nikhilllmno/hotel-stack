import { LoginDto, LoginResponseDto, SignupDto } from '../../dtos/AuthDto';
import {
  DuplicateUserError,
  InvalidCredentialsError,
} from '../../errors/AuthErrors';
import { BadRequestError } from '../../errors/BadRequestError';
import { User, UserRole } from '../../models/User';
import { comparePassword } from '../../utils/hash';
import { signLoginJwt } from '../../utils/jwtIssuer';
import logger from '../../utils/logger';
import { UserService } from '../user/userService';

// Type for User without password
type UserWithoutPassword = Omit<User, 'password'>;

export class AuthService {
  constructor(private userService: UserService = new UserService()) {}

  async login(params: LoginDto): Promise<LoginResponseDto> {
    const user = await this.userService.getUserAndPasswordByUsername(
      params.username,
    );

    if (!user) {
      throw new InvalidCredentialsError();
    }

    const isValid = await comparePassword(params.password, user.password);

    if (!isValid) {
      throw new InvalidCredentialsError();
    }

    const payload = {
      id: user.id,
      username: user.username,
      role: user.role,
      ...(user.hotel_id && { hotel_id: user.hotel_id }),
    };

    const authToken = signLoginJwt(payload);

    return {
      authToken,
      user: payload,
    };
  }

  async signup(params: SignupDto): Promise<UserWithoutPassword> {
    if (params.creatorRole !== UserRole.SUPERADMIN) {
      throw new BadRequestError(
        'signup:: You do not have the access to perform this action',
      );
    }

    if (!params.username || !params.password || !params.role) {
      throw new BadRequestError('signup:: Missing required fields');
    }
    const existingUser = await this.userService.getUserByUsername(
      params.username,
    );
    if (existingUser) {
      const errMsg = `signup:: Username already exists: ${params.username}`;
      logger.error(errMsg);
      throw new DuplicateUserError(params.username);
    }

    if (
      (params.role === UserRole.ADMIN || params.role === UserRole.USER) &&
      !params.hotel_id
    ) {
      const errMsg = `signup:: hotel_id is required for creating a user with role ${params.role}`;
      logger.error(errMsg);
      throw new BadRequestError(errMsg);
    }

    const user = await this.userService.createUser({
      username: params.username,
      password: params.password,
      role: params.role,
      creatorRole: params.creatorRole,
      hotel_id: params.hotel_id,
    });

    return user;
  }
}

export const authService = new AuthService();
export default authService;
