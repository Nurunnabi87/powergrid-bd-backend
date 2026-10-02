import crypto from 'crypto';
import AppError from '../../errors/AppError';
import { Prisma } from '../../generated/prisma/client';
import {
  BillStatus,
  NotificationType,
  PaymentProvider,
  PaymentStatus,
  UserRole,
} from '../../generated/prisma/enums';
import { writeAudit } from '../../shared/auditLog';
import * as bkash from '../../shared/bkash';
import { TTokenPayload } from '../../shared/jwt';
import { sendEmail } from '../../shared/mailer';
import prisma from '../../shared/prisma';
import { buildMeta, buildQueryOptions } from '../../shared/queryBuilder';
import * as stripe from '../../shared/stripe';
import { queueNotifications } from '../notification/notification.service';

const SORTABLE = ['createdAt', 'paidAt', 'amount'] as const;

const paymentSelect = {
  id: true,
  amount: true,
  currency: true,
  provider: true,
  status: true,
  paymentID: true,
  trxID: true,
  merchantInvoiceNumber: true,
  failureReason: true,
  initiatedAt: true,
  paidAt: true,
  createdAt: true,
  bill: {
    select: {
      id: true,
      billingPeriod: true,
      totalAmount: true,
      status: true,
      dueDate: true,
      connection: { select: { id: true, meterNo: true } },
    },
  },
  customer: { select: { id: true, name: true, email: true } },
} as const;

/** Fields every settlement path needs about the payment being settled. */
const settleSelect = {
  id: true,
  status: true,
  provider: true,
  billId: true,
  customerId: true,
  amount: true,
  currency: true,
  paymentID: true,
  trxID: true,
  customer: { select: { email: true, name: true } },
  bill: { select: { id: true, billingPeriod: true, status: true } },
} as const;

type TSettlePayment = Prisma.PaymentGetPayload<{ select: typeof settleSelect }>;

const PROVIDER_LABEL: Record<PaymentProvider, string> = {
  [PaymentProvider.BKASH]: 'bKash',
  [PaymentProvider.STRIPE]: 'card (Stripe)',
};

/** Invoice numbers must be unique per attempt on the gateway side. */
const buildInvoiceNumber = (billingPeriod: string): string =>
  `PG-${billingPeriod.replace('-', '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

// ---------- INITIATE ----------

const initiate = async (
  payload: { billId: string; provider?: PaymentProvider },
  user: TTokenPayload
) => {
  const { billId } = payload;
  const provider = payload.provider ?? PaymentProvider.BKASH;

  // Fail before any row is written, so an unconfigured gateway never
  // leaves a trail of FAILED payment attempts behind.
  if (provider === PaymentProvider.STRIPE && !stripe.isStripeConfigured()) {
    throw new AppError(503, 'Card payments are not configured on this server');
  }

  const bill = await prisma.bill.findFirst({
    where: { id: billId, isDeleted: false },
    select: {
      id: true,
      customerId: true,
      billingPeriod: true,
      totalAmount: true,
      status: true,
      connection: { select: { meterNo: true } },
      customer: { select: { id: true, phone: true, email: true } },
    },
  });

  if (!bill) throw new AppError(404, 'Bill not found');

  if (bill.customerId !== user.userId) {
    throw new AppError(403, 'You can only pay your own bills');
  }

  if (bill.status === BillStatus.PAID) {
    throw new AppError(400, 'This bill has already been paid');
  }

  // A completed payment for this bill means the bill row is stale, not that
  // a second charge should be allowed.
  const settled = await prisma.payment.findFirst({
    where: { billId, status: PaymentStatus.COMPLETED },
    select: { id: true },
  });

  if (settled) {
    throw new AppError(400, 'A completed payment already exists for this bill');
  }

  const merchantInvoiceNumber = buildInvoiceNumber(bill.billingPeriod);
  const payerReference = bill.customer.phone ?? bill.customer.email;

  if (provider === PaymentProvider.STRIPE) {
    return initiateStripe({ bill, merchantInvoiceNumber, payerReference, user });
  }

  const created = await bkash.createPayment({
    amount: bill.totalAmount,
    merchantInvoiceNumber,
    payerReference,
  });

  // The payment is tracked from the moment it is created, so an abandoned
  // checkout still leaves an auditable INITIATED row.
  const payment = await prisma.payment.create({
    data: {
      billId,
      customerId: user.userId,
      amount: bill.totalAmount,
      currency: 'BDT',
      provider: PaymentProvider.BKASH,
      status: PaymentStatus.INITIATED,
      paymentID: created.paymentID,
      merchantInvoiceNumber,
      payerReference,
      gatewayResponse: created as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, paymentID: true, amount: true, merchantInvoiceNumber: true },
  });

  await prisma.bill.update({
    where: { id: billId },
    data: { status: BillStatus.PENDING },
  });

  return {
    paymentId: payment.id,
    provider: PaymentProvider.BKASH,
    paymentID: payment.paymentID,
    merchantInvoiceNumber,
    amount: payment.amount,
    currency: 'BDT',
    redirectUrl: created.bkashURL,
    bkashURL: created.bkashURL,
    instruction:
      'Open redirectUrl in a browser to pay. Sandbox wallet 01770618575, OTP 123456, PIN 12121.',
  };
};

/**
 * Stripe needs our payment id inside its success/cancel URLs, so the row is
 * created first and the Checkout Session second - the reverse of bKash.
 */
const initiateStripe = async ({
  bill,
  merchantInvoiceNumber,
  payerReference,
  user,
}: {
  bill: {
    id: string;
    billingPeriod: string;
    totalAmount: number;
    connection: { meterNo: string };
    customer: { email: string };
  };
  merchantInvoiceNumber: string;
  payerReference: string;
  user: TTokenPayload;
}) => {
  const payment = await prisma.payment.create({
    data: {
      billId: bill.id,
      customerId: user.userId,
      amount: bill.totalAmount,
      currency: 'BDT',
      provider: PaymentProvider.STRIPE,
      status: PaymentStatus.INITIATED,
      merchantInvoiceNumber,
      payerReference,
    },
    select: { id: true, amount: true },
  });

  let session: stripe.TCheckoutSession;

  try {
    session = await stripe.createCheckoutSession({
      paymentId: payment.id,
      billId: bill.id,
      amount: bill.totalAmount,
      merchantInvoiceNumber,
      billingPeriod: bill.billingPeriod,
      meterNo: bill.connection.meterNo,
      customerEmail: bill.customer.email,
    });
  } catch (error) {
    // Keep the failed attempt on record rather than deleting it.
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        failureReason: (error as Error).message,
      },
    });
    throw error;
  }

  if (!session.url) {
    throw new AppError(502, 'Stripe did not return a checkout URL');
  }

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        paymentID: session.id,
        gatewayResponse: {
          sessionId: session.id,
          status: session.status,
          expiresAt: session.expires_at,
        },
      },
    }),
    prisma.bill.update({
      where: { id: bill.id },
      data: { status: BillStatus.PENDING },
    }),
  ]);

  return {
    paymentId: payment.id,
    provider: PaymentProvider.STRIPE,
    paymentID: session.id,
    merchantInvoiceNumber,
    amount: payment.amount,
    currency: 'BDT',
    redirectUrl: session.url,
    instruction:
      'Open redirectUrl to pay on Stripe Checkout. Test card 4242 4242 4242 4242, any future expiry, any CVC.',
  };
};

// ---------- SETTLEMENT (shared by every gateway) ----------

/**
 * Marks the payment COMPLETED and the bill PAID, and writes the notification
 * and audit entry, all in one transaction.
 *
 * The payment is claimed with a conditional update that only matches while
 * it is not yet COMPLETED - a compare-and-swap. When the redirect and the
 * webhook race each other, exactly one of them settles; the other sees
 * `count === 0` and reports "already processed" instead of double-settling.
 */
const settle = async (
  payment: TSettlePayment,
  trxID: string,
  gatewayResponse: unknown,
  actorId?: string
) => {
  const paidAt = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: { not: PaymentStatus.COMPLETED } },
      data: {
        status: PaymentStatus.COMPLETED,
        trxID,
        paidAt,
        failureReason: null,
        gatewayResponse: gatewayResponse as Prisma.InputJsonValue,
      },
    });

    if (claimed.count === 0) return null;

    await tx.bill.update({
      where: { id: payment.billId },
      data: { status: BillStatus.PAID, paidAt },
    });

    await queueNotifications(tx, [
      {
        userId: payment.customerId,
        type: NotificationType.PAYMENT_SUCCESS,
        title: 'Payment received',
        message: `BDT ${payment.amount.toFixed(2)} received via ${PROVIDER_LABEL[payment.provider]} for your ${payment.bill.billingPeriod} bill. Transaction ID: ${trxID}.`,
      },
    ]);

    await writeAudit(tx, {
      actorId: actorId ?? payment.customerId,
      action: 'PAYMENT_COMPLETED',
      entityType: 'Payment',
      entityId: payment.id,
      before: { status: payment.status },
      after: { status: PaymentStatus.COMPLETED, provider: payment.provider, trxID },
    });

    return tx.payment.findUniqueOrThrow({
      where: { id: payment.id },
      select: paymentSelect,
    });
  });

  if (!updated) {
    return { alreadyProcessed: true, paymentId: payment.id, trxID };
  }

  // Email is sent after the transaction commits so SMTP latency never holds
  // a database transaction open.
  await sendEmail({
    to: payment.customer.email,
    subject: `PowerGrid BD - payment receipt ${trxID}`,
    text: `Dear ${payment.customer.name}, we received BDT ${payment.amount.toFixed(2)} via ${PROVIDER_LABEL[payment.provider]} for your ${payment.bill.billingPeriod} electricity bill. Transaction ID: ${trxID}.`,
  });

  return { alreadyProcessed: false, paymentId: payment.id, payment: updated, trxID };
};

/**
 * Records a payment that did not complete and returns the bill to a payable
 * state. A no-op when the payment already settled, so a late cancel can
 * never undo a real charge.
 */
const markUnsuccessful = async (
  payment: Pick<TSettlePayment, 'id' | 'billId' | 'customerId' | 'provider'>,
  status: typeof PaymentStatus.CANCELLED | typeof PaymentStatus.FAILED,
  reason: string,
  gatewayResponse?: unknown
): Promise<boolean> => {
  return prisma.$transaction(async (tx) => {
    const changed = await tx.payment.updateMany({
      where: {
        id: payment.id,
        status: { in: [PaymentStatus.INITIATED, PaymentStatus.PENDING] },
      },
      data: {
        status,
        failureReason: reason,
        ...(gatewayResponse !== undefined && {
          gatewayResponse: gatewayResponse as Prisma.InputJsonValue,
        }),
      },
    });

    if (changed.count === 0) return false;

    // Only a bill still waiting on this checkout goes back to UNPAID.
    await tx.bill.updateMany({
      where: { id: payment.billId, status: BillStatus.PENDING },
      data: { status: BillStatus.UNPAID },
    });

    await tx.notification.create({
      data: {
        userId: payment.customerId,
        type: NotificationType.PAYMENT_FAILED,
        title: 'Payment not completed',
        message: `Your ${PROVIDER_LABEL[payment.provider]} payment was ${status === PaymentStatus.CANCELLED ? 'cancelled' : 'unsuccessful'}. You can try again from your bills.`,
      },
    });

    return true;
  });
};

// ---------- bKash FULFILLMENT ----------

const isCompleted = (status?: string): boolean => status?.toLowerCase() === 'completed';

/**
 * Confirms a bKash payment and settles the bill.
 *
 * Safe to call repeatedly: the callback redirect and the manual verify
 * endpoint both route through here, and a payment that is already
 * COMPLETED short-circuits instead of being processed twice.
 */
const fulfill = async (paymentID: string, actorId?: string) => {
  const payment = await prisma.payment.findUnique({
    where: { paymentID },
    select: settleSelect,
  });

  if (!payment) throw new AppError(404, 'No payment found for this bKash paymentID');

  if (payment.status === PaymentStatus.COMPLETED) {
    return { alreadyProcessed: true, paymentId: payment.id, trxID: payment.trxID };
  }

  // Execute finalises the charge. If bKash reports it was already executed
  // (a duplicate callback, or a retry after a timeout), fall back to the
  // authoritative status query rather than trusting the error.
  let result = await bkash.executePayment(paymentID);

  if (!isCompleted(result.transactionStatus)) {
    result = await bkash.queryPayment(paymentID);
  }

  if (!isCompleted(result.transactionStatus) || !result.trxID) {
    // transactionStatus is the payment's real state ("Initiated",
    // "Cancelled"...). statusMessage only describes whether the API call
    // itself succeeded, so it would report "Successful" for a payment the
    // payer never actually completed.
    const reason = result.transactionStatus
      ? `transaction status is "${result.transactionStatus}"`
      : (result.statusMessage ?? 'payment was not completed');

    await markUnsuccessful(payment, PaymentStatus.FAILED, reason, result);

    throw new AppError(400, `bKash did not complete this payment: ${reason}`);
  }

  return settle(payment, result.trxID, result, actorId);
};

// ---------- STRIPE FULFILLMENT ----------

/**
 * Confirms a Stripe Checkout payment by reading the session back from
 * Stripe. The success redirect is never trusted on its own: the session
 * must be `paid`, belong to this payment, and match the amount and currency.
 */
const fulfillStripe = async (payment: TSettlePayment, actorId?: string) => {
  if (payment.status === PaymentStatus.COMPLETED) {
    return { alreadyProcessed: true, paymentId: payment.id, trxID: payment.trxID };
  }

  if (!payment.paymentID) {
    throw new AppError(400, 'This payment never reached Stripe Checkout');
  }

  const session = await stripe.retrieveCheckoutSession(payment.paymentID);

  if (session.metadata?.paymentId !== payment.id) {
    throw new AppError(400, 'Stripe session does not belong to this payment');
  }

  const snapshot = {
    sessionId: session.id,
    status: session.status,
    paymentStatus: session.payment_status,
    amountTotal: session.amount_total,
    currency: session.currency,
    paymentIntent: stripe.paymentIntentId(session),
  };

  if (session.payment_status !== 'paid') {
    if (session.status === 'expired') {
      await markUnsuccessful(
        payment,
        PaymentStatus.FAILED,
        'Stripe checkout session expired before payment',
        snapshot
      );
      throw new AppError(400, 'This Stripe checkout expired before it was paid');
    }

    // Still open: the payer may yet complete it, so nothing is changed.
    throw new AppError(
      400,
      `Stripe has not confirmed this payment yet (session is ${session.status ?? 'unknown'})`
    );
  }

  const expected = stripe.toMinorUnits(payment.amount);

  if (session.amount_total !== expected || session.currency !== payment.currency.toLowerCase()) {
    await markUnsuccessful(
      payment,
      PaymentStatus.FAILED,
      `Amount mismatch: expected ${expected} ${payment.currency}, Stripe reported ${session.amount_total} ${session.currency}`,
      snapshot
    );
    throw new AppError(400, 'Stripe charged an amount that does not match this bill');
  }

  return settle(payment, snapshot.paymentIntent ?? session.id, snapshot, actorId);
};

/**
 * Stripe webhook events. Only a verified signature reaches this point
 * (checked in the controller), and every event funnels into the same
 * idempotent paths as the redirect, so replays are harmless.
 */
const handleStripeEvent = async (event: stripe.TStripeEvent) => {
  if (
    event.type !== 'checkout.session.completed' &&
    event.type !== 'checkout.session.async_payment_succeeded' &&
    event.type !== 'checkout.session.expired'
  ) {
    return { handled: false, type: event.type };
  }

  const session = event.data.object;
  const payment = await prisma.payment.findUnique({
    where: { paymentID: session.id },
    select: settleSelect,
  });

  // Sessions created outside this API (e.g. from the Stripe dashboard) are
  // acknowledged but ignored.
  if (!payment) return { handled: false, type: event.type };

  if (event.type === 'checkout.session.expired') {
    await markUnsuccessful(
      payment,
      PaymentStatus.CANCELLED,
      'Stripe checkout session expired'
    );
    return { handled: true, type: event.type };
  }

  if (session.payment_status === 'paid') {
    await fulfillStripe(payment);
  }

  return { handled: true, type: event.type };
};

// ---------- CALLBACK ----------

/**
 * bKash redirects the payer back here with ?paymentID=&status=
 * (success | failure | cancel).
 */
const handleCallback = async (query: { paymentID?: string; status?: string }) => {
  if (!query.paymentID) {
    throw new AppError(400, 'bKash callback did not include a paymentID');
  }

  const status = (query.status ?? '').toLowerCase();

  if (status === 'success') {
    const result = await fulfill(query.paymentID);
    return {
      outcome: 'success' as const,
      paymentId: result.paymentId,
      alreadyProcessed: result.alreadyProcessed,
      trxID: result.trxID,
    };
  }

  const payment = await prisma.payment.findUnique({
    where: { paymentID: query.paymentID },
    select: settleSelect,
  });

  if (!payment) throw new AppError(404, 'No payment found for this bKash paymentID');

  const cancelled = status === 'cancel';

  await markUnsuccessful(
    payment,
    cancelled ? PaymentStatus.CANCELLED : PaymentStatus.FAILED,
    `Payer ${cancelled ? 'cancelled' : 'failed'} the bKash checkout`
  );

  return {
    outcome: cancelled ? ('cancel' as const) : ('failed' as const),
    paymentId: payment.id,
  };
};

// ---------- MANUAL VERIFY / CANCEL ----------

const findOwnedPayment = async (id: string, user: TTokenPayload, verb: string) => {
  const payment = await prisma.payment.findUnique({
    where: { id },
    select: settleSelect,
  });

  if (!payment) throw new AppError(404, 'Payment not found');

  if (user.role === UserRole.CUSTOMER && payment.customerId !== user.userId) {
    throw new AppError(403, `You can only ${verb} your own payments`);
  }

  return payment;
};

/**
 * Re-checks a payment with its gateway and settles it if the gateway
 * confirms it. The frontend's success page calls this, and it doubles as
 * the safety net for a payer whose browser never came back.
 */
const verify = async (id: string, user: TTokenPayload) => {
  const payment = await findOwnedPayment(id, user, 'verify');

  if (payment.provider === PaymentProvider.STRIPE) {
    return fulfillStripe(payment, user.userId);
  }

  if (!payment.paymentID) {
    throw new AppError(400, 'This payment was never created at bKash');
  }

  return fulfill(payment.paymentID, user.userId);
};

/** Called by the frontend's cancel page when the payer backs out. */
const cancel = async (id: string, user: TTokenPayload) => {
  const payment = await findOwnedPayment(id, user, 'cancel');

  if (payment.status === PaymentStatus.COMPLETED) {
    throw new AppError(400, 'This payment has already been completed');
  }

  if (payment.status === PaymentStatus.CANCELLED || payment.status === PaymentStatus.FAILED) {
    return { id: payment.id, status: payment.status, alreadyClosed: true };
  }

  if (payment.provider === PaymentProvider.STRIPE && payment.paymentID) {
    const session = await stripe.retrieveCheckoutSession(payment.paymentID);

    // The payer finished paying in another tab before backing out: settle
    // instead of cancelling a real charge.
    if (session.payment_status === 'paid') {
      await fulfillStripe(payment, user.userId);
      return { id: payment.id, status: PaymentStatus.COMPLETED, alreadyClosed: true };
    }

    if (session.status === 'open') {
      await stripe.expireCheckoutSession(payment.paymentID);
    }
  }

  await markUnsuccessful(payment, PaymentStatus.CANCELLED, 'Payer cancelled the checkout');

  return { id: payment.id, status: PaymentStatus.CANCELLED, alreadyClosed: false };
};

// ---------- READS ----------

const getMine = async (userId: string, query: Record<string, unknown>) => {
  const { page, limit, skip, sortBy, sortOrder } = buildQueryOptions({
    query,
    sortableFields: SORTABLE,
  });

  const where = {
    customerId: userId,
    ...(query.status ? { status: query.status as PaymentStatus } : {}),
    ...(query.provider ? { provider: query.provider as PaymentProvider } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      select: paymentSelect,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.payment.count({ where }),
  ]);

  return { data, meta: buildMeta(page, limit, total) };
};

const getAll = async (query: Record<string, unknown>) => {
  const { page, limit, skip, sortBy, sortOrder } = buildQueryOptions({
    query,
    sortableFields: SORTABLE,
  });

  const where = {
    ...(query.status ? { status: query.status as PaymentStatus } : {}),
    ...(query.provider ? { provider: query.provider as PaymentProvider } : {}),
    ...(query.customerId ? { customerId: String(query.customerId) } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      select: paymentSelect,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.payment.count({ where }),
  ]);

  return { data, meta: buildMeta(page, limit, total) };
};

const getById = async (id: string, user: TTokenPayload) => {
  const payment = await prisma.payment.findUnique({
    where: { id },
    select: paymentSelect,
  });

  if (!payment) throw new AppError(404, 'Payment not found');

  if (user.role === UserRole.CUSTOMER && payment.customer.id !== user.userId) {
    throw new AppError(403, 'You can only view your own payments');
  }

  return payment;
};

export const PaymentService = {
  initiate,
  fulfill,
  handleCallback,
  handleStripeEvent,
  verify,
  cancel,
  getMine,
  getAll,
  getById,
};
