import { Request, Response } from 'express';
import { clientIp } from '../../shared/auditLog';
import { currentUser, param } from '../../shared/httpParams';
import sendResponse from '../../shared/sendResponse';
import { AdminService } from './admin.service';

const actorOf = (req: Request) => ({
  userId: currentUser(req).userId,
  ip: clientIp(req),
});

const getUsers = async (req: Request, res: Response): Promise<void> => {
  const { data, meta } = await AdminService.getUsers(
    req.query as Record<string, unknown>
  );
  sendResponse(res, {
    statusCode: 200,
    message: 'Users retrieved successfully',
    meta,
    data,
  });
};

const getTechnicians = async (req: Request, res: Response): Promise<void> => {
  const data = await AdminService.getTechnicians(req.query as Record<string, unknown>);
  sendResponse(res, {
    statusCode: 200,
    message: 'Technicians retrieved successfully',
    data,
  });
};

const updateRole = async (req: Request, res: Response): Promise<void> => {
  const data = await AdminService.updateRole(
    param(req, 'id'),
    req.body.role,
    actorOf(req)
  );
  sendResponse(res, {
    statusCode: 200,
    message: `${data.name} is now a ${data.role}`,
    data,
  });
};

const updateStatus = async (req: Request, res: Response): Promise<void> => {
  const data = await AdminService.updateStatus(
    param(req, 'id'),
    req.body.status,
    actorOf(req)
  );
  sendResponse(res, {
    statusCode: 200,
    message: `${data.name} is now ${data.status}`,
    data,
  });
};

const getDashboardStats = async (_req: Request, res: Response): Promise<void> => {
  const data = await AdminService.getDashboardStats();
  sendResponse(res, {
    statusCode: 200,
    message: `Dashboard statistics retrieved${data.cached ? ' (from cache)' : ''}`,
    data,
  });
};

const getAuditLogs = async (req: Request, res: Response): Promise<void> => {
  const { data, meta } = await AdminService.getAuditLogs(
    req.query as Record<string, unknown>
  );
  sendResponse(res, {
    statusCode: 200,
    message: 'Audit logs retrieved successfully',
    meta,
    data,
  });
};

const getContactMessages = async (req: Request, res: Response): Promise<void> => {
  const { data, meta } = await AdminService.getContactMessages(
    req.query as Record<string, unknown>
  );
  sendResponse(res, {
    statusCode: 200,
    message: 'Contact messages retrieved successfully',
    meta,
    data,
  });
};

const markContactRead = async (req: Request, res: Response): Promise<void> => {
  const data = await AdminService.markContactRead(param(req, 'id'));
  sendResponse(res, {
    statusCode: 200,
    message: data.alreadyRead ? 'Message was already read' : 'Message marked as read',
    data,
  });
};

const clearCache = async (_req: Request, res: Response): Promise<void> => {
  const data = await AdminService.clearCache();
  sendResponse(res, { statusCode: 200, message: 'Caches cleared', data });
};

export const AdminController = {
  getUsers,
  getTechnicians,
  updateRole,
  updateStatus,
  getDashboardStats,
  getAuditLogs,
  getContactMessages,
  markContactRead,
  clearCache,
};
