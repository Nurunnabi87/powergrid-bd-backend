import AppError from '../../errors/AppError';
import { Prisma } from '../../generated/prisma/client';
import {
  BillStatus,
  NotificationType,
  UserRole,
} from '../../generated/prisma/enums';
import { writeAudit } from '../../shared/auditLog';
import { TTokenPayload } from '../../shared/jwt';
import prisma from '../../shared/prisma';
import { buildMeta, buildQueryOptions } from '../../shared/queryBuilder';
import { queueNotifications } from '../notification/notification.service';

const SORTABLE = ['issuedAt', 'dueDate', 'totalAmount', 'createdAt'] as const;

/** Flat surcharge applied once a bill passes its due date. */
const LATE_FEE_RATE = 0.05;

const billSelect = {
  id: true,
  billingPeriod: true,
  unitsConsumed: true,
  tariffRate: true,
  amount: true,
  lateFee: true,
  totalAmount: true,
  dueDate: true,
  status: true,
  issuedAt: true,
  paidAt: true,
  createdAt: true,
  connection: {
    select: {
      id: true,
      meterNo: true,
      connectionType: true,
      area: { select: { id: true, name: true, code: true } },
    },
  },
  customer: { select: { id: true, name: true, email: true } },
} as const;

type TActor = { userId: string; ip: string | null };

const round2 = (value: number): number => Math.round(value * 100) / 100;

// ---------- BULK GENERATION ----------

/**
 * Issues one bill per active connection for a billing period.
 *
 * The `@@unique([connectionId, billingPeriod])` constraint makes this
 * operation safely re-runnable: `skipDuplicates` means a partial or
 * repeated run tops up the missing rows instead of double-billing anyone.
 */
const generate = async (
  payload: {
    billingPeriod: string;
    dueDate: string;
    areaId?: string;
    defaultUnits?: number;
  },
  actor: TActor
) => {
  const connections = await prisma.connection.findMany({
    where: {
      isDeleted: false,
      status: 'ACTIVE',
      ...(payload.areaId ? { areaId: payload.areaId } : {}),
    },
    select: { id: true, customerId: true, tariffRate: true, meterNo: true },
  });

  if (connections.length === 0) {
    throw new AppError(400, 'No active connections found for this billing run');
  }

  const dueDate = new Date(payload.dueDate);

  const rows = connections.map((connection) => {
    // Without a meter-reading feed, consumption is seeded deterministically
    // per meter so the demo data is stable rather than random noise.
    const units =
      payload.defaultUnits ??
      120 + (connection.meterNo.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 180);
    const amount = round2(units * connection.tariffRate);

    return {
      customerId: connection.customerId,
      connectionId: connection.id,
      billingPeriod: payload.billingPeriod,
      unitsConsumed: units,
      tariffRate: connection.tariffRate,
      amount,
      lateFee: 0,
      totalAmount: amount,
      dueDate,
    };
  });

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.bill.createMany({
      data: rows,
      skipDuplicates: true,
    });

    const issued = await tx.bill.findMany({
      where: {
        billingPeriod: payload.billingPeriod,
        connectionId: { in: connections.map((c) => c.id) },
      },
      select: { id: true, customerId: true, totalAmount: true },
    });

    await queueNotifications(
      tx,
      issued.map((bill) => ({
        userId: bill.customerId,
        type: NotificationType.BILL_GENERATED,
        title: `Your ${payload.billingPeriod} electricity bill is ready`,
        message: `Amount due: BDT ${bill.totalAmount.toFixed(2)}, payable by ${dueDate.toISOString().slice(0, 10)}.`,
      }))
    );

    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'BILLS_GENERATED',
      entityType: 'Bill',
      entityId: payload.billingPeriod,
      after: {
        billingPeriod: payload.billingPeriod,
        candidates: rows.length,
        created: created.count,
      },
      ipAddress: actor.ip,
    });

    return { created: created.count, total: issued.length };
  });

  return {
    billingPeriod: payload.billingPeriod,
    connectionsConsidered: connections.length,
    billsCreated: result.created,
    // Anything already present was skipped by the unique constraint.
    alreadyExisting: result.total - result.created,
  };
};

// ---------- OVERDUE SWEEP ----------

/** Moves past-due unpaid bills to OVERDUE and applies the late fee once. */
const applyOverdue = async (actor: TActor) => {
  const now = new Date();

  const due = await prisma.bill.findMany({
    where: {
      isDeleted: false,
      status: BillStatus.UNPAID,
      dueDate: { lt: now },
    },
    select: { id: true, amount: true },
  });

  if (due.length === 0) {
    return { updated: 0 };
  }

  const updated = await prisma.$transaction(
    due.map((bill) => {
      const lateFee = round2(bill.amount * LATE_FEE_RATE);
      return prisma.bill.update({
        where: { id: bill.id },
        data: {
          status: BillStatus.OVERDUE,
          lateFee,
          totalAmount: round2(bill.amount + lateFee),
        },
        select: { id: true },
      });
    })
  );

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'BILLS_MARKED_OVERDUE',
    entityType: 'Bill',
    entityId: now.toISOString().slice(0, 10),
    after: { updated: updated.length, lateFeeRate: LATE_FEE_RATE },
    ipAddress: actor.ip,
  });

  return { updated: updated.length };
};

// ---------- READS ----------

const buildWhere = (query: Record<string, unknown>): Prisma.BillWhereInput => ({
  isDeleted: false,
  ...(query.status ? { status: query.status as BillStatus } : {}),
  ...(query.billingPeriod ? { billingPeriod: String(query.billingPeriod) } : {}),
  ...(query.customerId ? { customerId: String(query.customerId) } : {}),
  ...(query.search
    ? { connection: { meterNo: { contains: String(query.search), mode: 'insensitive' } } }
    : {}),
});

const getAll = async (query: Record<string, unknown>) => {
  const { page, limit, skip, sortBy, sortOrder } = buildQueryOptions({
    query,
    sortableFields: SORTABLE,
    defaultSort: 'issuedAt',
  });

  const where = buildWhere(query);

  const [data, total] = await Promise.all([
    prisma.bill.findMany({
      where,
      select: billSelect,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.bill.count({ where }),
  ]);

  return { data, meta: buildMeta(page, limit, total) };
};

const getMine = async (userId: string, query: Record<string, unknown>) => {
  const { page, limit, skip, sortBy, sortOrder } = buildQueryOptions({
    query,
    sortableFields: SORTABLE,
    defaultSort: 'issuedAt',
  });

  const where = { ...buildWhere(query), customerId: userId };

  const [data, total, outstanding] = await Promise.all([
    prisma.bill.findMany({
      where,
      select: billSelect,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.bill.count({ where }),
    prisma.bill.aggregate({
      where: {
        customerId: userId,
        isDeleted: false,
        status: { in: [BillStatus.UNPAID, BillStatus.OVERDUE] },
      },
      _sum: { totalAmount: true },
    }),
  ]);

  return {
    data,
    meta: buildMeta(page, limit, total),
    outstandingAmount: round2(outstanding._sum.totalAmount ?? 0),
  };
};

const getById = async (id: string, user: TTokenPayload) => {
  const bill = await prisma.bill.findFirst({
    where: { id, isDeleted: false },
    select: {
      ...billSelect,
      payments: {
        select: {
          id: true,
          status: true,
          amount: true,
          trxID: true,
          paidAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!bill) throw new AppError(404, 'Bill not found');

  if (user.role === UserRole.CUSTOMER && bill.customer.id !== user.userId) {
    throw new AppError(403, 'You can only view your own bills');
  }

  return bill;
};

export const BillService = { generate, applyOverdue, getAll, getMine, getById };
