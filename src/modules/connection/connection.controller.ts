import { Request, Response } from 'express';
import { clientIp } from '../../shared/auditLog';
import { currentUser, param } from '../../shared/httpParams';
import sendResponse from '../../shared/sendResponse';
import { ConnectionService } from './connection.service';

const actorOf = (req: Request) => ({
  userId: currentUser(req).userId,
  ip: clientIp(req),
});

const create = async (req: Request, res: Response): Promise<void> => {
  const data = await ConnectionService.create(req.body, actorOf(req));
  sendResponse(res, {
    statusCode: 201,
    message: 'Connection created successfully',
    data,
  });
};

const getAll = async (req: Request, res: Response): Promise<void> => {
  const { data, meta } = await ConnectionService.getAll(
    req.query as Record<string, unknown>
  );
  sendResponse(res, {
    statusCode: 200,
    message: 'Connections retrieved successfully',
    meta,
    data,
  });
};

const getById = async (req: Request, res: Response): Promise<void> => {
  const data = await ConnectionService.getById(param(req, 'id'), currentUser(req));
  sendResponse(res, {
    statusCode: 200,
    message: 'Connection retrieved successfully',
    data,
  });
};

const update = async (req: Request, res: Response): Promise<void> => {
  const data = await ConnectionService.update(param(req, 'id'), req.body, actorOf(req));
  sendResponse(res, {
    statusCode: 200,
    message: 'Connection updated successfully',
    data,
  });
};

const softDelete = async (req: Request, res: Response): Promise<void> => {
  const data = await ConnectionService.softDelete(param(req, 'id'), actorOf(req));
  sendResponse(res, {
    statusCode: 200,
    message: 'Connection removed successfully',
    data,
  });
};

export const ConnectionController = { create, getAll, getById, update, softDelete };
