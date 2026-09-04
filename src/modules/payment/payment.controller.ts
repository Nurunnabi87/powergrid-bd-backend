import { Request, Response } from 'express';
import config from '../../config';
import { currentUser, param } from '../../shared/httpParams';
import sendResponse from '../../shared/sendResponse';
import { PaymentService } from './payment.service';

const initiate = async (req: Request, res: Response): Promise<void> => {
  const data = await PaymentService.initiate(req.body.billId, currentUser(req));
  sendResponse(res, {
    statusCode: 201,
    message: 'Payment session created. Open bkashURL to complete the payment',
    data,
  });
};

/**
 * bKash redirects the payer's BROWSER here, so this responds with a
 * redirect to the frontend rather than JSON. `?raw=true` returns JSON
 * instead, which is what makes the flow demonstrable in Postman.
 */
const handleCallback = async (req: Request, res: Response): Promise<void> => {
  const query = req.query as { paymentID?: string; status?: string; raw?: string };
  const result = await PaymentService.handleCallback(query);

  if (query.raw === 'true') {
    sendResponse(res, {
      statusCode: 200,
      message: `bKash callback processed: ${result.outcome}`,
      data: result,
    });
    return;
  }

  res.redirect(
    `${config.frontend_url}/payment/${result.outcome}?paymentID=${query.paymentID ?? ''}`
  );
};

const verify = async (req: Request, res: Response): Promise<void> => {
  const data = await PaymentService.verify(param(req, 'id'), currentUser(req));
  sendResponse(res, {
    statusCode: 200,
    message: data.alreadyProcessed
      ? 'Payment was already verified and settled'
      : 'Payment verified with bKash and settled',
    data,
  });
};

const getMine = async (req: Request, res: Response): Promise<void> => {
  const { data, meta } = await PaymentService.getMine(
    currentUser(req).userId,
    req.query as Record<string, unknown>
  );
  sendResponse(res, {
    statusCode: 200,
    message: 'Your payments retrieved successfully',
    meta,
    data,
  });
};

const getAll = async (req: Request, res: Response): Promise<void> => {
  const { data, meta } = await PaymentService.getAll(
    req.query as Record<string, unknown>
  );
  sendResponse(res, {
    statusCode: 200,
    message: 'Payments retrieved successfully',
    meta,
    data,
  });
};

const getById = async (req: Request, res: Response): Promise<void> => {
  const data = await PaymentService.getById(param(req, 'id'), currentUser(req));
  sendResponse(res, {
    statusCode: 200,
    message: 'Payment retrieved successfully',
    data,
  });
};

export const PaymentController = {
  initiate,
  handleCallback,
  verify,
  getMine,
  getAll,
  getById,
};
