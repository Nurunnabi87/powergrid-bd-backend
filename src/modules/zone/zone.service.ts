import AppError from '../../errors/AppError';
import prisma from '../../shared/prisma';
import { writeAudit } from '../../shared/auditLog';
import {
  buildMeta,
  buildQueryOptions,
  buildSearchFilter,
} from '../../shared/queryBuilder';
import { TMeta } from '../../shared/sendResponse';

const SORTABLE = ['name', 'code', 'city', 'createdAt', 'updatedAt'] as const;
const SEARCHABLE = ['name', 'code', 'city', 'district'] as const;

const zoneSelect = {
  id: true,
  name: true,
  code: true,
  city: true,
  district: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { substations: true } },
} as const;

type TActor = { userId: string; ip: string | null };

const create = async (
  payload: { name: string; code: string; city: string; district?: string },
  actor: TActor
) => {
  const zone = await prisma.distributionZone.create({
    data: payload,
    select: zoneSelect,
  });

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'ZONE_CREATED',
    entityType: 'DistributionZone',
    entityId: zone.id,
    after: { name: zone.name, code: zone.code, city: zone.city },
    ipAddress: actor.ip,
  });

  return zone;
};

const getAll = async (query: Record<string, unknown>) => {
  const { page, limit, skip, sortBy, sortOrder, search } = buildQueryOptions({
    query,
    sortableFields: SORTABLE,
  });

  const where = {
    isDeleted: false,
    ...(query.city ? { city: { equals: String(query.city), mode: 'insensitive' as const } } : {}),
    ...buildSearchFilter(search, SEARCHABLE),
  };

  // Rows and total are fetched together so pagination metadata never drifts
  // from the page actually returned.
  const [data, total] = await Promise.all([
    prisma.distributionZone.findMany({
      where,
      select: zoneSelect,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.distributionZone.count({ where }),
  ]);

  return { data, meta: buildMeta(page, limit, total) as TMeta };
};

const getById = async (id: string) => {
  const zone = await prisma.distributionZone.findFirst({
    where: { id, isDeleted: false },
    select: {
      ...zoneSelect,
      substations: {
        where: { isDeleted: false },
        select: { id: true, name: true, code: true, status: true, capacityMva: true },
        orderBy: { name: 'asc' },
      },
    },
  });

  if (!zone) throw new AppError(404, 'Distribution zone not found');

  return zone;
};

const update = async (
  id: string,
  payload: Partial<{ name: string; code: string; city: string; district: string }>,
  actor: TActor
) => {
  const existing = await prisma.distributionZone.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, name: true, code: true, city: true, district: true },
  });

  if (!existing) throw new AppError(404, 'Distribution zone not found');

  const zone = await prisma.distributionZone.update({
    where: { id },
    data: payload,
    select: zoneSelect,
  });

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'ZONE_UPDATED',
    entityType: 'DistributionZone',
    entityId: id,
    before: existing,
    after: payload,
    ipAddress: actor.ip,
  });

  return zone;
};

const softDelete = async (id: string, actor: TActor) => {
  const existing = await prisma.distributionZone.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, name: true, _count: { select: { substations: true } } },
  });

  if (!existing) throw new AppError(404, 'Distribution zone not found');

  // Refuse to orphan live infrastructure - the substations must be moved or
  // removed first. This mirrors the onDelete: Restrict constraint in the
  // schema, but returns a readable message instead of a raw FK error.
  const liveSubstations = await prisma.substation.count({
    where: { zoneId: id, isDeleted: false },
  });

  if (liveSubstations > 0) {
    throw new AppError(
      409,
      `Cannot delete this zone: ${liveSubstations} active substation(s) still belong to it`
    );
  }

  const zone = await prisma.distributionZone.update({
    where: { id },
    data: { isDeleted: true },
    select: { id: true, name: true, code: true, isDeleted: true },
  });

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'ZONE_DELETED',
    entityType: 'DistributionZone',
    entityId: id,
    before: { name: existing.name, isDeleted: false },
    after: { isDeleted: true },
    ipAddress: actor.ip,
  });

  return zone;
};

export const ZoneService = { create, getAll, getById, update, softDelete };
