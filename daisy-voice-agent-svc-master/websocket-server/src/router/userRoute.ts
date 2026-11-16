import { RequestHandler, Router } from 'express';
import { UserController } from '../controller/userController';
import { UserRepository } from '../repositories/UserRepository';
import { UserService } from '../services/user/userService';

const userRepository = new UserRepository();
const userService = new UserService(userRepository);
const userController = new UserController(userService);

const userRouter = Router();
userRouter.get('/:id', userController.getUserById as RequestHandler);
userRouter.patch('/:id', userController.updateUser as RequestHandler);
userRouter.delete('/:id', userController.deleteUser as RequestHandler);
userRouter.post('/', userController.createUser as RequestHandler);
userRouter.get('/', userController.getUsers as RequestHandler);

export default userRouter;
