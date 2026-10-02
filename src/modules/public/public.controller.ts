import { Request, Response } from 'express';
import { clientIp } from '../../shared/auditLog';
import sendResponse from '../../shared/sendResponse';
import { PublicService } from './public.service';

const getStats = async (_req: Request, res: Response): Promise<void> => {
  const data = await PublicService.getStats();
  sendResponse(res, {
    statusCode: 200,
    message: 'Grid statistics retrieved successfully',
    data,
  });
};

const getZones = async (_req: Request, res: Response): Promise<void> => {
  const data = await PublicService.getZones();
  sendResponse(res, {
    statusCode: 200,
    message: 'Distribution zones retrieved successfully',
    data,
  });
};

const getSchedules = async (_req: Request, res: Response): Promise<void> => {
  // validateRequest stores the parsed (coerced) query on res.locals.
  const { data, meta } = await PublicService.getSchedules(res.locals.query ?? {});
  sendResponse(res, {
    statusCode: 200,
    message: `Load-shedding schedule for ${meta.date} retrieved successfully`,
    meta,
    data,
  });
};

const submitContact = async (req: Request, res: Response): Promise<void> => {
  const data = await PublicService.submitContact(req.body, clientIp(req));
  sendResponse(res, {
    statusCode: 201,
    message: 'Thank you! Your message has been received',
    data,
  });
};

export const PublicController = { getStats, getZones, getSchedules, submitContact };
