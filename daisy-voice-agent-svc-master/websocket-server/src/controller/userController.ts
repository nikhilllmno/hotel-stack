import { Response } from 'express';
import { UserRole } from '../models/User';
import { UserService } from '../services/user/userService';
import { AuthenticatedRequest } from '../types/customRequest';
import logger from '../utils/logger';
import { handleCoreApiErrorAndSendResponse } from './util/helper';

export class UserController {
  constructor(private userService: UserService) {}

  public createUser = async (req: AuthenticatedRequest, res: Response) => {
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
      const result = await this.userService.createUser({
        username,
        password,
        creatorRole,
        role,
        hotel_id,
      });
      res.status(201).json(result);
    } catch (err: any) {
      logger.error(`Error creating user: ${err}`);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  };

  public getUserById = async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    try {
      const user = await this.userService.getUserById(id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json(user);
    } catch (err: any) {
      logger.error(`Error fetching user by ID: ${err}`);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  };

  public getUsers = async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const users = await this.userService.getUsers();
      res.json(users);
    } catch (err: any) {
      logger.error(`Error fetching all users: ${err}`);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  };

  public updateUser = async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const updateData = req.body;

    if (req.user?.role !== UserRole.SUPERADMIN) {
      return res
        .status(403)
        .json({ error: 'You do not have the access to perform this action' });
    }

    try {
      const updatedUser = await this.userService.updateUser(id, updateData);
      if (!updatedUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json(updatedUser);
    } catch (err: any) {
      logger.error(`Error updating user: ${err}`);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  };

  public deleteUser = async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    if (req.user?.role !== UserRole.SUPERADMIN) {
      return res
        .status(403)
        .json({ error: 'You do not have the access to perform this action' });
    }

    try {
      const deleted = await this.userService.deleteUser(id, req.user?.role);
      if (!deleted) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.status(200).send({ id, message: 'User deleted successfully' });
    } catch (err: any) {
      logger.error(`Error deleting user: ${err}`);
      handleCoreApiErrorAndSendResponse(err, res);
    }
  };
}
