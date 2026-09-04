import AppError from '../../errors/AppError';
import { PriorityTier } from '../../generated/prisma/enums';
import { writeAudit } from '../../shared/auditLog';
import { cacheInvalidate } from '../../shared/redis';
import prisma from '../../shared/prisma';
import {
  buildMeta,
  buildQueryOptions,
  buildSearchFilter,
} from '../../shared/queryBuilder';

const SORTABLE = ['name', 'code', 'population', 'createdAt', 'updatedAt'] as const;
const SEARCHABLE = ['name', 'code'] as const;

const areaSelect = {
  id: true,
  name: true,
  code: true,
  population: true,
  priorityTier: true,
  createdAt: true,
  updatedAt: true,
  feeder: {
    select: {
      id: true,
      name: true,
      code: true,
      substation: {
        select: {
          id: true,
          name: true,
          zone: { select: { id: true, name: true, code: true } },
        },
      },
    },
  },
  _count: { select: { connections: true } },
} as const;

type TActor = { userId: string; ip: string | null };

type TCreateInput = {
  name: string;
  code: string;
  feederId: string;
  population?: number;
  priorityTier?: PriorityTier;
};

const assertFeederExists = async (feederId: string): Promise<void> => {
  const feeder = await prisma.feeder.findFirst({
    where: { id: feederId, isDeleted: false },
    select: { id: true },
  });

  if (!feeder) throw new AppError(404, 'Feeder not found');
};

const create = async (payload: TCreateInput, actor: TActor) => {
  await assertFeederExists(payload.feederId);

  const area = await prisma.area.create({ data: payload, select: areaSelect });

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'AREA_CREATED',
    entityType: 'Area',
    entityId: area.id,
    after: { name: area.name, code: area.code, priorityTier: area.priorityTier },
    ipAddress: actor.ip,
  });

  return area;
};

const getAll = async (query: Record<string, unknown>) => {
  const { page, limit, skip, sortBy, sortOrder, search } = buildQueryOptions({
    query,
    sortableFields: SORTABLE,
  });

  const where = {
    isDeleted: false,
    ...(query.feederId ? { feederId: String(query.feederId) } : {}),
    ...(query.priorityTier ? { priorityTier: query.priorityTier as PriorityTier } : {}),
    ...(query.zoneId
      ? { feeder: { substation: { zoneId: String(query.zoneId) } } }
      : {}),
    ...buildSearchFilter(search, SEARCHABLE),
  };

  const [data, total] = await Promise.all([
    prisma.area.findMany({
      where,
      select: areaSelect,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.area.count({ where }),
  ]);

  return { data, meta: buildMeta(page, limit, total) };
};

const getById = async (id: string) => {
  const area = await prisma.area.findFirst({
    where: { id, isDeleted: false },
    select: areaSelect,
  });

  if (!area) throw new AppError(404, 'Area not found');

  return area;
};

const update = async (id: string, payload: Partial<TCreateInput>, actor: TActor) => {
  const existing = await prisma.area.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, name: true, code: true, priorityTier: true, population: true },
  });

  if (!existing) throw new AppError(404, 'Area not found');
  if (payload.feederId) await assertFeederExists(payload.feederId);

  const area = await prisma.area.update({
    where: { id },
    data: payload,
    select: areaSelect,
  });

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'AREA_UPDATED',
    entityType: 'Area',
    entityId: id,
    before: existing,
    after: payload,
    ipAddress: actor.ip,
  });

  // The priority tier feeds schedule generation, so any cached schedule
  // view for this area is now stale.
  if (payload.priorityTier || payload.feederId) {
    await cacheInvalidate(`schedule:area:${id}:*`);
  }

  return area;
};

const softDelete = async (id: string, actor: TActor) => {
  const existing = await prisma.area.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, name: true },
  });

  if (!existing) throw new AppError(404, 'Area not found');

  const liveConnections = await prisma.connection.count({
    where: { areaId: id, isDeleted: false },
  });

  if (liveConnections > 0) {
    throw new AppError(
      409,
      `Cannot delete this area: ${liveConnections} active connection(s) still belong to it`
    );
  }

  const area = await prisma.area.update({
    where: { id },
    data: { isDeleted: true },
    select: { id: true, name: true, code: true, isDeleted: true },
  });

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'AREA_DELETED',
    entityType: 'Area',
    entityId: id,
    before: { name: existing.name, isDeleted: false },
    after: { isDeleted: true },
    ipAddress: actor.ip,
  });

  await cacheInvalidate(`schedule:area:${id}:*`);

  return area;
};

export const AreaService = { create, getAll, getById, update, softDelete };
