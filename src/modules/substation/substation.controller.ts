import { Request, Response } from 'express';
import { clientIp } from '../../shared/auditLog';
import { param } from '../../shared/httpParams';
import sendResponse from '../../shared/sendResponse';
import { SubstationService } from './substation.service';

const actorOf = (req: Request) => ({
  userId: req.user!.userId,
  ip: clientIp(req),
});

const create = async (req: Request, res: Response): Promise<void> => {
  const data = await SubstationService.create(req.body, actorOf(req));
  sendResponse(res, {
    statusCode: 201,
    message: 'Substation created successfully',
    data,
  });
};

const getAll = async (req: Request, res: Response): Promise<void> => {
  const { data, meta } = await SubstationService.getAll(
    req.query as Record<string, unknown>
  );
  sendResponse(res, {
    statusCode: 200,
    message: 'Substations retrieved successfully',
    meta,
    data,
  });
};

const getById = async (req: Request, res: Response): Promise<void> => {
  const data = await SubstationService.getById(param(req, 'id'));
  sendResponse(res, {
    statusCode: 200,
    message: 'Substation retrieved successfully',
    data,
  });
};

const update = async (req: Request, res: Response): Promise<void> => {
  const data = await SubstationService.update(
    param(req, 'id'),
    req.body,
    actorOf(req)
  );
  sendResponse(res, {
    statusCode: 200,
    message: 'Substation updated successfully',
    data,
  });
};

const softDelete = async (req: Request, res: Response): Promise<void> => {
  const data = await SubstationService.softDelete(param(req, 'id'), actorOf(req));
  sendResponse(res, {
    statusCode: 200,
    message: 'Substation deleted successfully',
    data,
  });
};

export const SubstationController = {
  create,
  getAll,
  getById,
  update,
  softDelete,
};
