import { AuthController } from '../controller/authController';
import authService from '../services/auth/authService';

const authController = new AuthController(authService);
export default authController.router;
