import { Request, Response } from 'express';
import config from '../../config';
import AppError from '../../errors/AppError';
import { currentUser, param } from '../../shared/httpParams';
import sendResponse from '../../shared/sendResponse';
import { constructWebhookEvent } from '../../shared/stripe';
import { PaymentService } from './payment.service';

const initiate = async (req: Request, res: Response): Promise<void> => {
  const data = await PaymentService.initiate(req.body, currentUser(req));
  sendResponse(res, {
    statusCode: 201,
    message: 'Payment session created. Open redirectUrl to complete the payment',
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

  if (query.raw === 'true') {
    const result = await PaymentService.handleCallback(query);
    sendResponse(res, {
      statusCode: 200,
      message: `bKash callback processed: ${result.outcome}`,
      data: result,
    });
    return;
  }

  // A browser must always land on a page, never on a JSON error: a payment
  // bKash refused to confirm goes to the frontend's failure page instead.
  try {
    const result = await PaymentService.handleCallback(query);
    res.redirect(
      `${config.frontend_url}/payment/${result.outcome}?provider=bkash&paymentId=${result.paymentId}`
    );
  } catch (error) {
    const reason = error instanceof AppError ? error.message : 'Payment could not be verified';
    res.redirect(
      `${config.frontend_url}/payment/failed?provider=bkash&reason=${encodeURIComponent(reason)}`
    );
  }
};

/**
 * Stripe webhook. Mounted in app.ts BEFORE express.json, because signature
 * verification needs the exact raw bytes Stripe sent.
 */
const stripeWebhook = async (req: Request, res: Response): Promise<void> => {
  const event = constructWebhookEvent(
    req.body as Buffer,
    req.header('stripe-signature')
  );
  const result = await PaymentService.handleStripeEvent(event);
  res.status(200).json({ received: true, ...result });
};

const verify = async (req: Request, res: Response): Promise<void> => {
  const data = await PaymentService.verify(param(req, 'id'), currentUser(req));
  sendResponse(res, {
    statusCode: 200,
    message: data.alreadyProcessed
      ? 'Payment was already verified and settled'
      : 'Payment verified with the gateway and settled',
    data,
  });
};

const cancel = async (req: Request, res: Response): Promise<void> => {
  const data = await PaymentService.cancel(param(req, 'id'), currentUser(req));
  sendResponse(res, {
    statusCode: 200,
    message:
      data.status === 'COMPLETED'
        ? 'This payment had already been completed'
        : 'Payment cancelled; the bill can be paid again',
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
  stripeWebhook,
  verify,
  cancel,
  getMine,
  getAll,
  getById,
};
