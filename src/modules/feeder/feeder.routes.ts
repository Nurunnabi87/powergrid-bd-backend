import { Router } from 'express';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { FeederController } from './feeder.controller';
import { FeederValidation } from './feeder.validation';

const router = Router();

router.get('/', auth(), FeederController.getAll);

router.get(
  '/:id',
  auth(),
  validateRequest(FeederValidation.idParamSchema),
  FeederController.getById
);

router.post(
  '/',
  auth('ADMIN'),
  validateRequest(FeederValidation.createFeederSchema),
  FeederController.create
);

router.patch(
  '/:id',
  auth('ADMIN'),
  validateRequest(FeederValidation.idParamSchema),
  validateRequest(FeederValidation.updateFeederSchema),
  FeederController.update
);

router.delete(
  '/:id',
  auth('ADMIN'),
  validateRequest(FeederValidation.idParamSchema),
  FeederController.softDelete
);

export const FeederRoutes = router;
