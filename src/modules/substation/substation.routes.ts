import { Router } from 'express';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { SubstationController } from './substation.controller';
import { SubstationValidation } from './substation.validation';

const router = Router();

router.get('/', auth(), SubstationController.getAll);

router.get(
  '/:id',
  auth(),
  validateRequest(SubstationValidation.idParamSchema),
  SubstationController.getById
);

router.post(
  '/',
  auth('ADMIN'),
  validateRequest(SubstationValidation.createSubstationSchema),
  SubstationController.create
);

router.patch(
  '/:id',
  auth('ADMIN'),
  validateRequest(SubstationValidation.idParamSchema),
  validateRequest(SubstationValidation.updateSubstationSchema),
  SubstationController.update
);

router.delete(
  '/:id',
  auth('ADMIN'),
  validateRequest(SubstationValidation.idParamSchema),
  SubstationController.softDelete
);

export const SubstationRoutes = router;
