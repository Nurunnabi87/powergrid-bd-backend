import AppError from '../../errors/AppError';
import { writeAudit } from '../../shared/auditLog';
import prisma from '../../shared/prisma';
import {
  buildMeta,
  buildQueryOptions,
  buildSearchFilter,
} from '../../shared/queryBuilder';

const SORTABLE = ['name', 'code', 'loadKw', 'createdAt', 'updatedAt'] as const;
const SEARCHABLE = ['name', 'code', 'voltageLevel'] as const;

const feederSelect = {
  id: true,
  name: true,
  code: true,
  voltageLevel: true,
  loadKw: true,
  createdAt: true,
  updatedAt: true,
  substation: {
    select: {
      id: true,
      name: true,
      code: true,
      zone: { select: { id: true, name: true, code: true } },
    },
  },
  _count: { select: { areas: true } },
} as const;

type TActor = { userId: string; ip: string | null };

type TCreateInput = {
  name: string;
  code: string;
  substationId: string;
  voltageLevel: string;
  loadKw: number;
};

const assertSubstationExists = async (substationId: string): Promise<void> => {
  const substation = await prisma.substation.findFirst({
    where: { id: substationId, isDeleted: false },
    select: { id: true },
  });

  if (!substation) throw new AppError(404, 'Substation not found');
};

const create = async (payload: TCreateInput, actor: TActor) => {
  await assertSubstationExists(payload.substationId);

  const feeder = await prisma.feeder.create({
    data: payload,
    select: feederSelect,
  });

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'FEEDER_CREATED',
    entityType: 'Feeder',
    entityId: feeder.id,
    after: { name: feeder.name, code: feeder.code },
    ipAddress: actor.ip,
  });

  return feeder;
};

const getAll = async (query: Record<string, unknown>) => {
  const { page, limit, skip, sortBy, sortOrder, search } = buildQueryOptions({
    query,
    sortableFields: SORTABLE,
  });

  const where = {
    isDeleted: false,
    ...(query.substationId ? { substationId: String(query.substationId) } : {}),
    // Filtering by zone reaches two levels up the hierarchy.
    ...(query.zoneId
      ? { substation: { zoneId: String(query.zoneId), isDeleted: false } }
      : {}),
    ...buildSearchFilter(search, SEARCHABLE),
  };

  const [data, total] = await Promise.all([
    prisma.feeder.findMany({
      where,
      select: feederSelect,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.feeder.count({ where }),
  ]);

  return { data, meta: buildMeta(page, limit, total) };
};

const getById = async (id: string) => {
  const feeder = await prisma.feeder.findFirst({
    where: { id, isDeleted: false },
    select: {
      ...feederSelect,
      areas: {
        where: { isDeleted: false },
        select: {
          id: true,
          name: true,
          code: true,
          priorityTier: true,
          population: true,
        },
        orderBy: { name: 'asc' },
      },
    },
  });

  if (!feeder) throw new AppError(404, 'Feeder not found');

  return feeder;
};

const update = async (id: string, payload: Partial<TCreateInput>, actor: TActor) => {
  const existing = await prisma.feeder.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, name: true, code: true, loadKw: true, voltageLevel: true },
  });

  if (!existing) throw new AppError(404, 'Feeder not found');
  if (payload.substationId) await assertSubstationExists(payload.substationId);

  const feeder = await prisma.feeder.update({
    where: { id },
    data: payload,
    select: feederSelect,
  });

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'FEEDER_UPDATED',
    entityType: 'Feeder',
    entityId: id,
    before: existing,
    after: payload,
    ipAddress: actor.ip,
  });

  return feeder;
};

const softDelete = async (id: string, actor: TActor) => {
  const existing = await prisma.feeder.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, name: true },
  });

  if (!existing) throw new AppError(404, 'Feeder not found');

  const liveAreas = await prisma.area.count({
    where: { feederId: id, isDeleted: false },
  });

  if (liveAreas > 0) {
    throw new AppError(
      409,
      `Cannot delete this feeder: ${liveAreas} active area(s) still belong to it`
    );
  }

  const feeder = await prisma.feeder.update({
    where: { id },
    data: { isDeleted: true },
    select: { id: true, name: true, code: true, isDeleted: true },
  });

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'FEEDER_DELETED',
    entityType: 'Feeder',
    entityId: id,
    before: { name: existing.name, isDeleted: false },
    after: { isDeleted: true },
    ipAddress: actor.ip,
  });

  return feeder;
};

export const FeederService = { create, getAll, getById, update, softDelete };
