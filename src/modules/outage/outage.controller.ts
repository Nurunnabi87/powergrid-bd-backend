import { Request, Response } from 'express';
import { clientIp } from '../../shared/auditLog';
import { uploadBuffer } from '../../shared/cloudinary';
import { currentUser, param } from '../../shared/httpParams';
import sendResponse from '../../shared/sendResponse';
import { OutageService } from './outage.service';

const actorOf = (req: Request) => ({
  userId: currentUser(req).userId,
  ip: clientIp(req),
});

const report = async (req: Request, res: Response): Promise<void> => {
  // The photo is optional: a customer reporting a fault at night may not be
  // able to take one, and the report must not be blocked on it.
  const photoUrl = req.file
    ? await uploadBuffer(req.file.buffer, 'powergrid/outages')
    : undefined;

  const data = await OutageService.report(
    { ...req.body, photoUrl },
    actorOf(req)
  );

  sendResponse(res, {
    statusCode: 201,
    message: 'Outage reported successfully. Our team has been notified',
    data,
  });
};

const getAll = async (req: Request, res: Response): Promise<void> => {
  const { data, meta } = await OutageService.getAll(
    req.query as Record<string, unknown>
  );
  sendResponse(res, {
    statusCode: 200,
    message: 'Outages retrieved successfully',
    meta,
    data,
  });
};

const getMyReports = async (req: Request, res: Response): Promise<void> => {
  const { data, meta } = await OutageService.getMyReports(
    currentUser(req).userId,
    req.query as Record<string, unknown>
  );
  sendResponse(res, {
    statusCode: 200,
    message: 'Your reported outages retrieved successfully',
    meta,
    data,
  });
};

const getMyAssignments = async (req: Request, res: Response): Promise<void> => {
  const { data, meta } = await OutageService.getMyAssignments(
    currentUser(req).userId,
    req.query as Record<string, unknown>
  );
  sendResponse(res, {
    statusCode: 200,
    message: 'Your assigned outages retrieved successfully',
    meta,
    data,
  });
};

const getById = async (req: Request, res: Response): Promise<void> => {
  const data = await OutageService.getById(param(req, 'id'), currentUser(req));
  sendResponse(res, {
    statusCode: 200,
    message: 'Outage retrieved successfully',
    data,
  });
};

const acknowledge = async (req: Request, res: Response): Promise<void> => {
  const data = await OutageService.acknowledge(param(req, 'id'), actorOf(req));
  sendResponse(res, {
    statusCode: 200,
    message: 'Outage acknowledged',
    data,
  });
};

const assign = async (req: Request, res: Response): Promise<void> => {
  const data = await OutageService.assign(
    param(req, 'id'),
    req.body.technicianId,
    req.body.notes,
    actorOf(req)
  );
  sendResponse(res, {
    statusCode: 200,
    message: `Outage assigned to ${data.assignment.technician.name}`,
    data: data.assignment,
  });
};

const updateStatus = async (req: Request, res: Response): Promise<void> => {
  const data = await OutageService.updateStatus(
    param(req, 'id'),
    req.body.status,
    req.body.note,
    currentUser(req),
    clientIp(req)
  );
  sendResponse(res, {
    statusCode: 200,
    message: `Outage moved to ${req.body.status}`,
    data,
  });
};

const restore = async (req: Request, res: Response): Promise<void> => {
  const data = await OutageService.restore(
    param(req, 'id'),
    req.body?.note,
    currentUser(req),
    clientIp(req)
  );
  sendResponse(res, {
    statusCode: 200,
    message: `Power restored after ${data.downtimeMinutes} minute(s). ${data.customersNotified} customer(s) notified`,
    data,
  });
};

const softDelete = async (req: Request, res: Response): Promise<void> => {
  const data = await OutageService.softDelete(param(req, 'id'), actorOf(req));
  sendResponse(res, {
    statusCode: 200,
    message: 'Outage removed successfully',
    data,
  });
};

export const OutageController = {
  report,
  getAll,
  getMyReports,
  getMyAssignments,
  getById,
  acknowledge,
  assign,
  updateStatus,
  restore,
  softDelete,
};
