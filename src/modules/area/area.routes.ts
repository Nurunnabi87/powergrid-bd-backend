import { Router } from 'express';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { AreaController } from './area.controller';
import { AreaValidation } from './area.validation';

const router = Router();

router.get('/', auth(), AreaController.getAll);

router.get(
  '/:id',
  auth(),
  validateRequest(AreaValidation.idParamSchema),
  AreaController.getById
);

router.post(
  '/',
  auth('ADMIN'),
  validateRequest(AreaValidation.createAreaSchema),
  AreaController.create
);

router.patch(
  '/:id',
  auth('ADMIN'),
  validateRequest(AreaValidation.idParamSchema),
  validateRequest(AreaValidation.updateAreaSchema),
  AreaController.update
);

router.delete(
  '/:id',
  auth('ADMIN'),
  validateRequest(AreaValidation.idParamSchema),
  AreaController.softDelete
);

export const AreaRoutes = router;
