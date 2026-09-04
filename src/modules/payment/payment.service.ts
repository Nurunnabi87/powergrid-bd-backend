import crypto from 'crypto';
import AppError from '../../errors/AppError';
import { Prisma } from '../../generated/prisma/client';
import {
  BillStatus,
  NotificationType,
  PaymentStatus,
  UserRole,
} from '../../generated/prisma/enums';
import { writeAudit } from '../../shared/auditLog';
import * as bkash from '../../shared/bkash';
import { TTokenPayload } from '../../shared/jwt';
import { sendEmail } from '../../shared/mailer';
import prisma from '../../shared/prisma';
import { buildMeta, buildQueryOptions } from '../../shared/queryBuilder';
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

/** Invoice numbers must be unique per attempt on the bKash side. */
const buildInvoiceNumber = (billingPeriod: string): string =>
  `PG-${billingPeriod.replace('-', '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

// ---------- INITIATE ----------

const initiate = async (billId: string, user: TTokenPayload) => {
  const bill = await prisma.bill.findFirst({
    where: { id: billId, isDeleted: false },
    select: {
      id: true,
      customerId: true,
      billingPeriod: true,
      totalAmount: true,
      status: true,
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

  const created = await bkash.createPayment({
    amount: bill.totalAmount,
    merchantInvoiceNumber,
    payerReference: bill.customer.phone ?? bill.customer.email,
  });

  // The payment is tracked from the moment it is created, so an abandoned
  // checkout still leaves an auditable INITIATED row.
  const payment = await prisma.payment.create({
    data: {
      billId,
      customerId: user.userId,
      amount: bill.totalAmount,
      currency: 'BDT',
      status: PaymentStatus.INITIATED,
      paymentID: created.paymentID,
      merchantInvoiceNumber,
      payerReference: bill.customer.phone ?? bill.customer.email,
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
    paymentID: payment.paymentID,
    merchantInvoiceNumber,
    amount: payment.amount,
    currency: 'BDT',
    bkashURL: created.bkashURL,
    instruction:
      'Open bkashURL in a browser to pay. Sandbox wallet 01770618575, OTP 123456, PIN 12121.',
  };
};

// ---------- IDEMPOTENT FULFILLMENT ----------

const isCompleted = (status?: string): boolean => status?.toLowerCase() === 'completed';

/**
 * Confirms a payment with bKash and settles the bill.
 *
 * Safe to call repeatedly: the callback redirect and the manual verify
 * endpoint both route through here, and a payment that is already
 * COMPLETED short-circuits instead of being processed twice.
 */
const fulfill = async (paymentID: string, actorId?: string) => {
  const payment = await prisma.payment.findUnique({
    where: { paymentID },
    select: {
      id: true,
      status: true,
      billId: true,
      customerId: true,
      amount: true,
      trxID: true,
      customer: { select: { email: true, name: true } },
      bill: { select: { id: true, billingPeriod: true } },
    },
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

  if (!isCompleted(result.transactionStatus)) {
    // transactionStatus is the payment's real state ("Initiated",
    // "Cancelled"...). statusMessage only describes whether the API call
    // itself succeeded, so it would report "Successful" for a payment the
    // payer never actually completed.
    const reason = result.transactionStatus
      ? `transaction status is "${result.transactionStatus}"`
      : (result.statusMessage ?? 'payment was not completed');

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        failureReason: reason,
        gatewayResponse: result as unknown as Prisma.InputJsonValue,
      },
    });

    // The bill goes back to being payable so the customer can retry.
    await prisma.bill.update({
      where: { id: payment.billId },
      data: { status: BillStatus.UNPAID },
    });

    throw new AppError(400, `bKash did not complete this payment: ${reason}`);
  }

  const paidAt = new Date();

  // Payment, bill, notification and audit all settle together or not at all.
  const settled = await prisma.$transaction(async (tx) => {
    const updatedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.COMPLETED,
        trxID: result.trxID,
        paidAt,
        failureReason: null,
        gatewayResponse: result as unknown as Prisma.InputJsonValue,
      },
      select: paymentSelect,
    });

    await tx.bill.update({
      where: { id: payment.billId },
      data: { status: BillStatus.PAID, paidAt },
    });

    await queueNotifications(tx, [
      {
        userId: payment.customerId,
        type: NotificationType.PAYMENT_SUCCESS,
        title: 'Payment received',
        message: `BDT ${payment.amount.toFixed(2)} received for your ${payment.bill.billingPeriod} bill. Transaction ID: ${result.trxID}.`,
      },
    ]);

    await writeAudit(tx, {
      actorId: actorId ?? payment.customerId,
      action: 'PAYMENT_COMPLETED',
      entityType: 'Payment',
      entityId: payment.id,
      before: { status: payment.status },
      after: { status: PaymentStatus.COMPLETED, trxID: result.trxID },
    });

    return updatedPayment;
  });

  // Email is sent after the transaction commits so SMTP latency never holds
  // a database transaction open.
  await sendEmail({
    to: payment.customer.email,
    subject: `PowerGrid BD - payment receipt ${result.trxID}`,
    text: `Dear ${payment.customer.name}, we received BDT ${payment.amount.toFixed(2)} for your ${payment.bill.billingPeriod} electricity bill. Transaction ID: ${result.trxID}.`,
  });

  return { alreadyProcessed: false, payment: settled, trxID: result.trxID };
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
      alreadyProcessed: result.alreadyProcessed,
      trxID: result.trxID,
    };
  }

  const payment = await prisma.payment.findUnique({
    where: { paymentID: query.paymentID },
    select: { id: true, billId: true, status: true, customerId: true },
  });

  if (!payment) throw new AppError(404, 'No payment found for this bKash paymentID');

  if (payment.status !== PaymentStatus.COMPLETED) {
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: status === 'cancel' ? PaymentStatus.CANCELLED : PaymentStatus.FAILED,
          failureReason: `Payer ${status === 'cancel' ? 'cancelled' : 'failed'} the bKash checkout`,
        },
      }),
      // Return the bill to a payable state so the customer can try again.
      prisma.bill.update({
        where: { id: payment.billId },
        data: { status: BillStatus.UNPAID },
      }),
      prisma.notification.create({
        data: {
          userId: payment.customerId,
          type: NotificationType.PAYMENT_FAILED,
          title: 'Payment not completed',
          message: `Your bKash payment was ${status === 'cancel' ? 'cancelled' : 'unsuccessful'}. You can try again from your bills.`,
        },
      }),
    ]);
  }

  return {
    outcome: status === 'cancel' ? ('cancelled' as const) : ('failed' as const),
  };
};

// ---------- MANUAL VERIFY ----------

/** Safety net for when the payer's browser never returns from bKash. */
const verify = async (id: string, user: TTokenPayload) => {
  const payment = await prisma.payment.findUnique({
    where: { id },
    select: { id: true, paymentID: true, customerId: true, status: true },
  });

  if (!payment) throw new AppError(404, 'Payment not found');

  if (user.role === UserRole.CUSTOMER && payment.customerId !== user.userId) {
    throw new AppError(403, 'You can only verify your own payments');
  }

  if (!payment.paymentID) {
    throw new AppError(400, 'This payment was never created at bKash');
  }

  return fulfill(payment.paymentID, user.userId);
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
  verify,
  getMine,
  getAll,
  getById,
};
