import { Router } from 'express';
import auth from '../../middlewares/auth';
import { singleImage } from '../../middlewares/upload';
import validateRequest from '../../middlewares/validateRequest';
import { OutageController } from './outage.controller';
import { OutageValidation } from './outage.validation';

const router = Router();

// Static paths first so they are never captured by /:id.
router.get('/my-reports', auth('CUSTOMER'), OutageController.getMyReports);
router.get('/my-assignments', auth('TECHNICIAN'), OutageController.getMyAssignments);

router.post(
  '/report',
  auth('CUSTOMER'),
  // multipart/form-data with an optional "photo" field; JSON bodies work too.
  singleImage('photo'),
  validateRequest(OutageValidation.reportOutageSchema),
  OutageController.report
);

router.get('/', auth('ADMIN', 'TECHNICIAN'), OutageController.getAll);

router.get(
  '/:id',
  auth(),
  validateRequest(OutageValidation.idParamSchema),
  OutageController.getById
);

router.patch(
  '/:id/acknowledge',
  auth('ADMIN'),
  validateRequest(OutageValidation.idParamSchema),
  OutageController.acknowledge
);

router.post(
  '/:id/assign',
  auth('ADMIN'),
  validateRequest(OutageValidation.idParamSchema),
  validateRequest(OutageValidation.assignSchema),
  OutageController.assign
);

router.patch(
  '/:id/status',
  auth('ADMIN', 'TECHNICIAN'),
  validateRequest(OutageValidation.idParamSchema),
  validateRequest(OutageValidation.updateStatusSchema),
  OutageController.updateStatus
);

router.post(
  '/:id/restore',
  auth('ADMIN', 'TECHNICIAN'),
  validateRequest(OutageValidation.idParamSchema),
  validateRequest(OutageValidation.restoreSchema),
  OutageController.restore
);

router.delete(
  '/:id',
  auth('ADMIN'),
  validateRequest(OutageValidation.idParamSchema),
  OutageController.softDelete
);

export const OutageRoutes = router;
