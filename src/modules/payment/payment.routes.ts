import { Router } from 'express';
import auth from '../../middlewares/auth';
import { paymentLimiter } from '../../middlewares/rateLimiter';
import validateRequest from '../../middlewares/validateRequest';
import { PaymentController } from './payment.controller';
import { PaymentValidation } from './payment.validation';

const router = Router();

// bKash calls this from the payer's browser, so it cannot carry a Bearer
// token. It is safe to leave open because the paymentID is unguessable and
// every state change is re-verified against bKash's own API.
router.get('/bkash/callback', PaymentController.handleCallback);

router.get('/my', auth('CUSTOMER'), PaymentController.getMine);

router.post(
  '/initiate',
  auth('CUSTOMER'),
  paymentLimiter,
  validateRequest(PaymentValidation.initiateSchema),
  PaymentController.initiate
);

router.get('/', auth('ADMIN'), PaymentController.getAll);

router.post(
  '/:id/verify',
  auth('CUSTOMER', 'ADMIN'),
  paymentLimiter,
  validateRequest(PaymentValidation.idParamSchema),
  PaymentController.verify
);

router.get(
  '/:id',
  auth(),
  validateRequest(PaymentValidation.idParamSchema),
  PaymentController.getById
);

export const PaymentRoutes = router;
