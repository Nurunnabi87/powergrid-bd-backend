import { Router } from 'express';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { ConnectionController } from './connection.controller';
import { ConnectionValidation } from './connection.validation';

const router = Router();

router.get('/', auth('ADMIN'), ConnectionController.getAll);

// Ownership is enforced inside the service so a customer can read their own
// meter here without the route needing a separate customer-only path.
router.get(
  '/:id',
  auth(),
  validateRequest(ConnectionValidation.idParamSchema),
  ConnectionController.getById
);

router.post(
  '/',
  auth('ADMIN'),
  validateRequest(ConnectionValidation.createConnectionSchema),
  ConnectionController.create
);

router.patch(
  '/:id',
  auth('ADMIN'),
  validateRequest(ConnectionValidation.idParamSchema),
  validateRequest(ConnectionValidation.updateConnectionSchema),
  ConnectionController.update
);

router.delete(
  '/:id',
  auth('ADMIN'),
  validateRequest(ConnectionValidation.idParamSchema),
  ConnectionController.softDelete
);

export const ConnectionRoutes = router;
