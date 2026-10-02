import { Router } from 'express';
import { contactLimiter } from '../../middlewares/rateLimiter';
import validateRequest from '../../middlewares/validateRequest';
import { PublicController } from './public.controller';
import { PublicValidation } from './public.validation';

// No auth on this router: it backs the public website.
const router = Router();

router.get('/stats', PublicController.getStats);
router.get('/zones', PublicController.getZones);

router.get(
  '/schedules',
  validateRequest(PublicValidation.scheduleQuerySchema),
  PublicController.getSchedules
);

router.post(
  '/contact',
  contactLimiter,
  validateRequest(PublicValidation.contactSchema),
  PublicController.submitContact
);

export const PublicRoutes = router;
