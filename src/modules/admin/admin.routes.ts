import { Router } from 'express';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { AdminController } from './admin.controller';
import { AdminValidation } from './admin.validation';

// Every route in this module is ADMIN-only.
const router = Router();

router.use(auth('ADMIN'));

router.get('/users', AdminController.getUsers);
router.get('/technicians', AdminController.getTechnicians);

router.patch(
  '/users/:id/role',
  validateRequest(AdminValidation.idParamSchema),
  validateRequest(AdminValidation.updateRoleSchema),
  AdminController.updateRole
);

router.patch(
  '/users/:id/status',
  validateRequest(AdminValidation.idParamSchema),
  validateRequest(AdminValidation.updateStatusSchema),
  AdminController.updateStatus
);

router.get('/dashboard-stats', AdminController.getDashboardStats);
router.get('/audit-logs', AdminController.getAuditLogs);

router.get('/contact-messages', AdminController.getContactMessages);
router.patch(
  '/contact-messages/:id/read',
  validateRequest(AdminValidation.messageIdParamSchema),
  AdminController.markContactRead
);

router.post('/cache/clear', AdminController.clearCache);

export const AdminRoutes = router;
