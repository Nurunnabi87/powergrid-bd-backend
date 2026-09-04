import { Router } from 'express';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { ScheduleController } from './schedule.controller';
import { ScheduleValidation } from './schedule.validation';

const router = Router();

// Static paths are declared before /:id so they are not captured as ids.
router.get('/my', auth('CUSTOMER'), ScheduleController.getMine);

router.post(
  '/generate',
  auth('ADMIN'),
  validateRequest(ScheduleValidation.generateScheduleSchema),
  ScheduleController.generate
);

router.get('/', auth(), ScheduleController.getAll);

router.get(
  '/:id',
  auth(),
  validateRequest(ScheduleValidation.idParamSchema),
  ScheduleController.getById
);

router.post(
  '/',
  auth('ADMIN'),
  validateRequest(ScheduleValidation.createScheduleSchema),
  ScheduleController.create
);

router.patch(
  '/:id/status',
  auth('ADMIN'),
  validateRequest(ScheduleValidation.idParamSchema),
  validateRequest(ScheduleValidation.updateStatusSchema),
  ScheduleController.updateStatus
);

router.delete(
  '/:id',
  auth('ADMIN'),
  validateRequest(ScheduleValidation.idParamSchema),
  ScheduleController.softDelete
);

export const ScheduleRoutes = router;
