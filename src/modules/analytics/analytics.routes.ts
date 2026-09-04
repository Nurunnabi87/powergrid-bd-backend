import { Router } from 'express';
import auth from '../../middlewares/auth';
import { AnalyticsController } from './analytics.controller';

const router = Router();

router.get('/outages', auth('ADMIN'), AnalyticsController.getOutageAnalytics);

router.get(
  '/load-shedding',
  auth('ADMIN'),
  AnalyticsController.getLoadSheddingAnalytics
);

router.get('/technicians', auth('ADMIN'), AnalyticsController.getTechnicianPerformance);

export const AnalyticsRoutes = router;
