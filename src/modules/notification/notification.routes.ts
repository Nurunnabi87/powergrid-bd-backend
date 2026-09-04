import { Router } from 'express';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { NotificationController } from './notification.controller';
import { NotificationValidation } from './notification.validation';

const router = Router();

router.get('/my', auth(), NotificationController.getMine);

// Registered before /:id so "read-all" is never captured as an id.
router.patch('/read-all', auth(), NotificationController.markAllRead);

router.patch(
  '/:id/read',
  auth(),
  validateRequest(NotificationValidation.idParamSchema),
  NotificationController.markRead
);

export const NotificationRoutes = router;
