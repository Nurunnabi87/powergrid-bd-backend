import { Router } from 'express';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { BillController } from './bill.controller';
import { BillValidation } from './bill.validation';

const router = Router();

router.get('/my', auth('CUSTOMER'), BillController.getMine);

router.post(
  '/generate',
  auth('ADMIN'),
  validateRequest(BillValidation.generateBillsSchema),
  BillController.generate
);

router.post('/apply-overdue', auth('ADMIN'), BillController.applyOverdue);

router.get('/', auth('ADMIN'), BillController.getAll);

router.get(
  '/:id',
  auth(),
  validateRequest(BillValidation.idParamSchema),
  BillController.getById
);

export const BillRoutes = router;
