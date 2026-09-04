import { Request, Response } from 'express';
import { clientIp } from '../../shared/auditLog';
import { param } from '../../shared/httpParams';
import sendResponse from '../../shared/sendResponse';
import { FeederService } from './feeder.service';

const actorOf = (req: Request) => ({
  userId: req.user!.userId,
  ip: clientIp(req),
});

const create = async (req: Request, res: Response): Promise<void> => {
  const data = await FeederService.create(req.body, actorOf(req));
  sendResponse(res, { statusCode: 201, message: 'Feeder created successfully', data });
};

const getAll = async (req: Request, res: Response): Promise<void> => {
  const { data, meta } = await FeederService.getAll(
    req.query as Record<string, unknown>
  );
  sendResponse(res, {
    statusCode: 200,
    message: 'Feeders retrieved successfully',
    meta,
    data,
  });
};

const getById = async (req: Request, res: Response): Promise<void> => {
  const data = await FeederService.getById(param(req, 'id'));
  sendResponse(res, {
    statusCode: 200,
    message: 'Feeder retrieved successfully',
    data,
  });
};

const update = async (req: Request, res: Response): Promise<void> => {
  const data = await FeederService.update(param(req, 'id'), req.body, actorOf(req));
  sendResponse(res, { statusCode: 200, message: 'Feeder updated successfully', data });
};

const softDelete = async (req: Request, res: Response): Promise<void> => {
  const data = await FeederService.softDelete(param(req, 'id'), actorOf(req));
  sendResponse(res, { statusCode: 200, message: 'Feeder deleted successfully', data });
};

export const FeederController = { create, getAll, getById, update, softDelete };
