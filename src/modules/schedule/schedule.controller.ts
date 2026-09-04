import { Request, Response } from 'express';
import { clientIp } from '../../shared/auditLog';
import { currentUser, param } from '../../shared/httpParams';
import sendResponse from '../../shared/sendResponse';
import { ScheduleService } from './schedule.service';

const actorOf = (req: Request) => ({
  userId: currentUser(req).userId,
  ip: clientIp(req),
});

const create = async (req: Request, res: Response): Promise<void> => {
  const data = await ScheduleService.create(req.body, actorOf(req));
  sendResponse(res, {
    statusCode: 201,
    message: 'Load-shedding schedule created successfully',
    data,
  });
};

const generate = async (req: Request, res: Response): Promise<void> => {
  const data = await ScheduleService.generate(req.body, actorOf(req));
  sendResponse(res, {
    statusCode: 201,
    message: `Generated ${data.slotsCreated} load-shedding slot(s), protecting ${data.feedersProtected} critical feeder(s)`,
    data,
  });
};

const getAll = async (req: Request, res: Response): Promise<void> => {
  const { data, meta } = await ScheduleService.getAll(
    req.query as Record<string, unknown>
  );
  sendResponse(res, {
    statusCode: 200,
    message: 'Load-shedding schedules retrieved successfully',
    meta,
    data,
  });
};

const getMine = async (req: Request, res: Response): Promise<void> => {
  const { data, cached } = await ScheduleService.getMine(currentUser(req).userId);
  sendResponse(res, {
    statusCode: 200,
    message: `Your upcoming load-shedding schedule${cached ? ' (served from cache)' : ''}`,
    data,
  });
};

const getById = async (req: Request, res: Response): Promise<void> => {
  const data = await ScheduleService.getById(param(req, 'id'));
  sendResponse(res, {
    statusCode: 200,
    message: 'Load-shedding schedule retrieved successfully',
    data,
  });
};

const updateStatus = async (req: Request, res: Response): Promise<void> => {
  const data = await ScheduleService.updateStatus(
    param(req, 'id'),
    req.body.status,
    actorOf(req)
  );
  sendResponse(res, {
    statusCode: 200,
    message: `Schedule marked as ${req.body.status}`,
    data,
  });
};

const softDelete = async (req: Request, res: Response): Promise<void> => {
  const data = await ScheduleService.softDelete(param(req, 'id'), actorOf(req));
  sendResponse(res, {
    statusCode: 200,
    message: 'Load-shedding schedule deleted successfully',
    data,
  });
};

export const ScheduleController = {
  create,
  generate,
  getAll,
  getMine,
  getById,
  updateStatus,
  softDelete,
};
