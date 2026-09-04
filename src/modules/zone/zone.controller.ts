import { Request, Response } from 'express';
import { clientIp } from '../../shared/auditLog';
import { param } from '../../shared/httpParams';
import sendResponse from '../../shared/sendResponse';
import { ZoneService } from './zone.service';

/** Every admin write records who did it and from where. */
const actorOf = (req: Request) => ({
  userId: req.user!.userId,
  ip: clientIp(req),
});

const create = async (req: Request, res: Response): Promise<void> => {
  const data = await ZoneService.create(req.body, actorOf(req));

  sendResponse(res, {
    statusCode: 201,
    message: 'Distribution zone created successfully',
    data,
  });
};

const getAll = async (req: Request, res: Response): Promise<void> => {
  const { data, meta } = await ZoneService.getAll(req.query as Record<string, unknown>);

  sendResponse(res, {
    statusCode: 200,
    message: 'Distribution zones retrieved successfully',
    meta,
    data,
  });
};

const getById = async (req: Request, res: Response): Promise<void> => {
  const data = await ZoneService.getById(param(req, 'id'));

  sendResponse(res, {
    statusCode: 200,
    message: 'Distribution zone retrieved successfully',
    data,
  });
};

const update = async (req: Request, res: Response): Promise<void> => {
  const data = await ZoneService.update(param(req, 'id'), req.body, actorOf(req));

  sendResponse(res, {
    statusCode: 200,
    message: 'Distribution zone updated successfully',
    data,
  });
};

const softDelete = async (req: Request, res: Response): Promise<void> => {
  const data = await ZoneService.softDelete(param(req, 'id'), actorOf(req));

  sendResponse(res, {
    statusCode: 200,
    message: 'Distribution zone deleted successfully',
    data,
  });
};

export const ZoneController = { create, getAll, getById, update, softDelete };
