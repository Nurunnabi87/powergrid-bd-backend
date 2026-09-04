import AppError from '../../errors/AppError';
import {
  ConnectionStatus,
  ConnectionType,
  UserRole,
} from '../../generated/prisma/enums';
import { writeAudit } from '../../shared/auditLog';
import prisma from '../../shared/prisma';
import { buildMeta, buildQueryOptions } from '../../shared/queryBuilder';
import { TTokenPayload } from '../../shared/jwt';

const SORTABLE = ['meterNo', 'tariffRate', 'createdAt', 'updatedAt'] as const;

const connectionSelect = {
  id: true,
  meterNo: true,
  connectionType: true,
  tariffRate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, name: true, email: true, phone: true } },
  area: {
    select: {
      id: true,
      name: true,
      code: true,
      priorityTier: true,
      feeder: { select: { id: true, name: true, code: true } },
    },
  },
} as const;

type TActor = { userId: string; ip: string | null };

type TCreateInput = {
  meterNo: string;
  customerId: string;
  areaId: string;
  connectionType?: ConnectionType;
  tariffRate?: number;
};

const create = async (payload: TCreateInput, actor: TActor) => {
  const [customer, area] = await Promise.all([
    prisma.user.findFirst({
      where: { id: payload.customerId, isDeleted: false },
      select: { id: true, role: true },
    }),
    prisma.area.findFirst({
      where: { id: payload.areaId, isDeleted: false },
      select: { id: true },
    }),
  ]);

  if (!customer) throw new AppError(404, 'Customer not found');
  if (customer.role !== UserRole.CUSTOMER) {
    throw new AppError(400, 'Connections can only be issued to CUSTOMER accounts');
  }
  if (!area) throw new AppError(404, 'Area not found');

  const connection = await prisma.connection.create({
    data: payload,
    select: connectionSelect,
  });

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'CONNECTION_CREATED',
    entityType: 'Connection',
    entityId: connection.id,
    after: { meterNo: connection.meterNo, customerId: payload.customerId },
    ipAddress: actor.ip,
  });

  return connection;
};

const getAll = async (query: Record<string, unknown>) => {
  const { page, limit, skip, sortBy, sortOrder, search } = buildQueryOptions({
    query,
    sortableFields: SORTABLE,
  });

  const where = {
    isDeleted: false,
    ...(query.areaId ? { areaId: String(query.areaId) } : {}),
    ...(query.customerId ? { customerId: String(query.customerId) } : {}),
    ...(query.connectionType
      ? { connectionType: query.connectionType as ConnectionType }
      : {}),
    ...(query.status ? { status: query.status as ConnectionStatus } : {}),
    // Meter numbers are looked up by exact-ish prefix rather than a wide
    // OR across relations, which keeps the query on the meterNo index.
    ...(search ? { meterNo: { contains: search, mode: 'insensitive' as const } } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.connection.findMany({
      where,
      select: connectionSelect,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.connection.count({ where }),
  ]);

  return { data, meta: buildMeta(page, limit, total) };
};

const getById = async (id: string, user: TTokenPayload) => {
  const connection = await prisma.connection.findFirst({
    where: { id, isDeleted: false },
    select: connectionSelect,
  });

  if (!connection) throw new AppError(404, 'Connection not found');

  // Customers may only read their own meters; admins and technicians see all.
  if (
    user.role === UserRole.CUSTOMER &&
    connection.customer.id !== user.userId
  ) {
    throw new AppError(403, 'You can only view your own connections');
  }

  return connection;
};

const update = async (
  id: string,
  payload: Partial<Omit<TCreateInput, 'customerId'>>,
  actor: TActor
) => {
  const existing = await prisma.connection.findFirst({
    where: { id, isDeleted: false },
    select: {
      id: true,
      meterNo: true,
      tariffRate: true,
      status: true,
      connectionType: true,
    },
  });

  if (!existing) throw new AppError(404, 'Connection not found');

  if (payload.areaId) {
    const area = await prisma.area.findFirst({
      where: { id: payload.areaId, isDeleted: false },
      select: { id: true },
    });
    if (!area) throw new AppError(404, 'Area not found');
  }

  const connection = await prisma.connection.update({
    where: { id },
    data: payload,
    select: connectionSelect,
  });

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'CONNECTION_UPDATED',
    entityType: 'Connection',
    entityId: id,
    before: existing,
    after: payload,
    ipAddress: actor.ip,
  });

  return connection;
};

const softDelete = async (id: string, actor: TActor) => {
  const existing = await prisma.connection.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, meterNo: true },
  });

  if (!existing) throw new AppError(404, 'Connection not found');

  const unpaidBills = await prisma.bill.count({
    where: { connectionId: id, isDeleted: false, status: { in: ['UNPAID', 'OVERDUE'] } },
  });

  if (unpaidBills > 0) {
    throw new AppError(
      409,
      `Cannot remove this connection: ${unpaidBills} unpaid bill(s) are still outstanding`
    );
  }

  const connection = await prisma.connection.update({
    where: { id },
    data: { isDeleted: true, status: ConnectionStatus.DISCONNECTED },
    select: { id: true, meterNo: true, status: true, isDeleted: true },
  });

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'CONNECTION_DELETED',
    entityType: 'Connection',
    entityId: id,
    before: { meterNo: existing.meterNo, isDeleted: false },
    after: { isDeleted: true },
    ipAddress: actor.ip,
  });

  return connection;
};

export const ConnectionService = { create, getAll, getById, update, softDelete };
