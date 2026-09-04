import { Request, Response } from 'express';
import { clientIp } from '../../shared/auditLog';
import { param } from '../../shared/httpParams';
import sendResponse from '../../shared/sendResponse';
import { AreaService } from './area.service';

const actorOf = (req: Request) => ({
  userId: req.user!.userId,
  ip: clientIp(req),
});

const create = async (req: Request, res: Response): Promise<void> => {
  const data = await AreaService.create(req.body, actorOf(req));
  sendResponse(res, { statusCode: 201, message: 'Area created successfully', data });
};

const getAll = async (req: Request, res: Response): Promise<void> => {
  const { data, meta } = await AreaService.getAll(req.query as Record<string, unknown>);
  sendResponse(res, {
    statusCode: 200,
    message: 'Areas retrieved successfully',
    meta,
    data,
  });
};

const getById = async (req: Request, res: Response): Promise<void> => {
  const data = await AreaService.getById(param(req, 'id'));
  sendResponse(res, { statusCode: 200, message: 'Area retrieved successfully', data });
};

const update = async (req: Request, res: Response): Promise<void> => {
  const data = await AreaService.update(param(req, 'id'), req.body, actorOf(req));
  sendResponse(res, { statusCode: 200, message: 'Area updated successfully', data });
};

const softDelete = async (req: Request, res: Response): Promise<void> => {
  const data = await AreaService.softDelete(param(req, 'id'), actorOf(req));
  sendResponse(res, { statusCode: 200, message: 'Area deleted successfully', data });
};

export const AreaController = { create, getAll, getById, update, softDelete };
