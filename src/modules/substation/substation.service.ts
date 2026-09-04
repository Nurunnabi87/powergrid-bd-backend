import AppError from '../../errors/AppError';
import { SubstationStatus } from '../../generated/prisma/enums';
import { writeAudit } from '../../shared/auditLog';
import prisma from '../../shared/prisma';
import {
  buildMeta,
  buildQueryOptions,
  buildSearchFilter,
} from '../../shared/queryBuilder';

const SORTABLE = ['name', 'code', 'capacityMva', 'createdAt', 'updatedAt'] as const;
const SEARCHABLE = ['name', 'code'] as const;

const substationSelect = {
  id: true,
  name: true,
  code: true,
  capacityMva: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  zone: { select: { id: true, name: true, code: true, city: true } },
  _count: { select: { feeders: true } },
} as const;

type TActor = { userId: string; ip: string | null };

type TCreateInput = {
  name: string;
  code: string;
  zoneId: string;
  capacityMva: number;
  status?: SubstationStatus;
};

/** Guards against attaching infrastructure to a missing or deleted parent. */
const assertZoneExists = async (zoneId: string): Promise<void> => {
  const zone = await prisma.distributionZone.findFirst({
    where: { id: zoneId, isDeleted: false },
    select: { id: true },
  });

  if (!zone) throw new AppError(404, 'Distribution zone not found');
};

const create = async (payload: TCreateInput, actor: TActor) => {
  await assertZoneExists(payload.zoneId);

  const substation = await prisma.substation.create({
    data: payload,
    select: substationSelect,
  });

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'SUBSTATION_CREATED',
    entityType: 'Substation',
    entityId: substation.id,
    after: { name: substation.name, code: substation.code, zoneId: payload.zoneId },
    ipAddress: actor.ip,
  });

  return substation;
};

const getAll = async (query: Record<string, unknown>) => {
  const { page, limit, skip, sortBy, sortOrder, search } = buildQueryOptions({
    query,
    sortableFields: SORTABLE,
  });

  const where = {
    isDeleted: false,
    ...(query.zoneId ? { zoneId: String(query.zoneId) } : {}),
    ...(query.status ? { status: query.status as SubstationStatus } : {}),
    ...buildSearchFilter(search, SEARCHABLE),
  };

  const [data, total] = await Promise.all([
    prisma.substation.findMany({
      where,
      select: substationSelect,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.substation.count({ where }),
  ]);

  return { data, meta: buildMeta(page, limit, total) };
};

const getById = async (id: string) => {
  const substation = await prisma.substation.findFirst({
    where: { id, isDeleted: false },
    select: {
      ...substationSelect,
      feeders: {
        where: { isDeleted: false },
        select: { id: true, name: true, code: true, voltageLevel: true, loadKw: true },
        orderBy: { name: 'asc' },
      },
    },
  });

  if (!substation) throw new AppError(404, 'Substation not found');

  return substation;
};

const update = async (
  id: string,
  payload: Partial<TCreateInput>,
  actor: TActor
) => {
  const existing = await prisma.substation.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, name: true, code: true, status: true, capacityMva: true },
  });

  if (!existing) throw new AppError(404, 'Substation not found');
  if (payload.zoneId) await assertZoneExists(payload.zoneId);

  const substation = await prisma.substation.update({
    where: { id },
    data: payload,
    select: substationSelect,
  });

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'SUBSTATION_UPDATED',
    entityType: 'Substation',
    entityId: id,
    before: existing,
    after: payload,
    ipAddress: actor.ip,
  });

  return substation;
};

const softDelete = async (id: string, actor: TActor) => {
  const existing = await prisma.substation.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, name: true },
  });

  if (!existing) throw new AppError(404, 'Substation not found');

  const liveFeeders = await prisma.feeder.count({
    where: { substationId: id, isDeleted: false },
  });

  if (liveFeeders > 0) {
    throw new AppError(
      409,
      `Cannot delete this substation: ${liveFeeders} active feeder(s) still belong to it`
    );
  }

  const substation = await prisma.substation.update({
    where: { id },
    data: { isDeleted: true },
    select: { id: true, name: true, code: true, isDeleted: true },
  });

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'SUBSTATION_DELETED',
    entityType: 'Substation',
    entityId: id,
    before: { name: existing.name, isDeleted: false },
    after: { isDeleted: true },
    ipAddress: actor.ip,
  });

  return substation;
};

export const SubstationService = {
  create,
  getAll,
  getById,
  update,
  softDelete,
};
