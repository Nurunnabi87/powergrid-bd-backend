import { Router } from 'express';
import auth from '../../middlewares/auth';
import { singleImage } from '../../middlewares/upload';
import validateRequest from '../../middlewares/validateRequest';
import { UserController } from './user.controller';
import { UserValidation } from './user.validation';

const router = Router();

router.get('/me', auth(), UserController.getMe);

router.patch(
  '/me',
  auth(),
  validateRequest(UserValidation.updateMeSchema),
  UserController.updateMe
);

router.patch('/me/avatar', auth(), singleImage('avatar'), UserController.updateAvatar);

router.get('/me/connections', auth(), UserController.getMyConnections);

export const UserRoutes = router;
