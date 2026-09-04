import { Router } from 'express';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { ZoneController } from './zone.controller';
import { ZoneValidation } from './zone.validation';

const router = Router();

// Reads are open to any authenticated user; writes are ADMIN-only.
router.get('/', auth(), ZoneController.getAll);

router.get(
  '/:id',
  auth(),
  validateRequest(ZoneValidation.idParamSchema),
  ZoneController.getById
);

router.post(
  '/',
  auth('ADMIN'),
  validateRequest(ZoneValidation.createZoneSchema),
  ZoneController.create
);

router.patch(
  '/:id',
  auth('ADMIN'),
  validateRequest(ZoneValidation.idParamSchema),
  validateRequest(ZoneValidation.updateZoneSchema),
  ZoneController.update
);

router.delete(
  '/:id',
  auth('ADMIN'),
  validateRequest(ZoneValidation.idParamSchema),
  ZoneController.softDelete
);

export const ZoneRoutes = router;
