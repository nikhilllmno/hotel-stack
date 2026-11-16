import { RequestHandler, Response, Router } from 'express';
import { UserRole } from '../models/User';
import { AuthService } from '../services/auth/authService';
import { AuthenticatedRequest } from '../types/customRequest';
import logger from '../utils/logger';

export class AuthController {
  public router: Router;

  constructor(private authService: AuthService) {
    this.router = Router();
    this.router.post('/login', this.login as RequestHandler);
    this.router.post('/signup', this.signup as RequestHandler);
  }

  private login = async (req: AuthenticatedRequest, res: Response) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: 'Username and password are required' });
    }

    try {
      const result = await this.authService.login({ username, password });
      res.status(200).json(result);
    } catch (err: any) {
      logger.error(`Error during login: ${err}`);
      res.status(401).json({ error: err.message || 'Unauthorized' });
    }
  };

  private signup = async (req: AuthenticatedRequest, res: Response) => {
    const { username, password, role, hotel_id } = req.body;

    // role: role of the user being created
    // creatorRole: role of the user creating the new user
    const creatorRole = req.user?.role;
    if (creatorRole !== UserRole.SUPERADMIN) {
      return res
        .status(403)
        .json({ error: 'You do not have the access to perform this action' });
    }

    if (!username || !password || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      const user = await this.authService.signup({
        username,
        password,
        creatorRole,
        role,
        hotel_id,
      });
      res.status(201).json(user);
    } catch (err: any) {
      logger.error(`Error during signup: ${err}`);
      res.status(400).json({ error: err.message || 'Signup failed' });
    }
  };
}
