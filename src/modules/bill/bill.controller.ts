import { Request, Response } from 'express';
import { clientIp } from '../../shared/auditLog';
import { currentUser, param } from '../../shared/httpParams';
import sendResponse from '../../shared/sendResponse';
import { BillService } from './bill.service';

const actorOf = (req: Request) => ({
  userId: currentUser(req).userId,
  ip: clientIp(req),
});

const generate = async (req: Request, res: Response): Promise<void> => {
  const data = await BillService.generate(req.body, actorOf(req));
  sendResponse(res, {
    statusCode: 201,
    message: `Generated ${data.billsCreated} bill(s) for ${data.billingPeriod} (${data.alreadyExisting} already existed)`,
    data,
  });
};

const applyOverdue = async (req: Request, res: Response): Promise<void> => {
  const data = await BillService.applyOverdue(actorOf(req));
  sendResponse(res, {
    statusCode: 200,
    message: `${data.updated} bill(s) marked overdue with a late fee applied`,
    data,
  });
};

const getAll = async (req: Request, res: Response): Promise<void> => {
  const { data, meta } = await BillService.getAll(req.query as Record<string, unknown>);
  sendResponse(res, {
    statusCode: 200,
    message: 'Bills retrieved successfully',
    meta,
    data,
  });
};

const getMine = async (req: Request, res: Response): Promise<void> => {
  const { data, meta, outstandingAmount } = await BillService.getMine(
    currentUser(req).userId,
    req.query as Record<string, unknown>
  );
  sendResponse(res, {
    statusCode: 200,
    message: `Your bills retrieved successfully (outstanding: BDT ${outstandingAmount.toFixed(2)})`,
    meta,
    data,
  });
};

const getById = async (req: Request, res: Response): Promise<void> => {
  const data = await BillService.getById(param(req, 'id'), currentUser(req));
  sendResponse(res, { statusCode: 200, message: 'Bill retrieved successfully', data });
};

export const BillController = { generate, applyOverdue, getAll, getMine, getById };
