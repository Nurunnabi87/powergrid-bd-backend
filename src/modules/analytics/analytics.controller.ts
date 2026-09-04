import { Request, Response } from 'express';
import sendResponse from '../../shared/sendResponse';
import { AnalyticsService } from './analytics.service';

const range = (req: Request) => ({
  from: typeof req.query.from === 'string' ? req.query.from : undefined,
  to: typeof req.query.to === 'string' ? req.query.to : undefined,
});

const getOutageAnalytics = async (req: Request, res: Response): Promise<void> => {
  const data = await AnalyticsService.getOutageAnalytics(range(req));
  sendResponse(res, {
    statusCode: 200,
    message: `Outage analytics retrieved${data.cached ? ' (from cache)' : ''}`,
    data,
  });
};

const getLoadSheddingAnalytics = async (req: Request, res: Response): Promise<void> => {
  const data = await AnalyticsService.getLoadSheddingAnalytics(range(req));
  sendResponse(res, {
    statusCode: 200,
    message: `Load-shedding analytics retrieved${data.cached ? ' (from cache)' : ''}`,
    data,
  });
};

const getTechnicianPerformance = async (
  _req: Request,
  res: Response
): Promise<void> => {
  const data = await AnalyticsService.getTechnicianPerformance();
  sendResponse(res, {
    statusCode: 200,
    message: 'Technician performance retrieved successfully',
    data,
  });
};

export const AnalyticsController = {
  getOutageAnalytics,
  getLoadSheddingAnalytics,
  getTechnicianPerformance,
};
