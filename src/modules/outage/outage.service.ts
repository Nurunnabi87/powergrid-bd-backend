import AppError from '../../errors/AppError';
import { Prisma } from '../../generated/prisma/client';
import {
  AssignmentStatus,
  NotificationType,
  OutageSeverity,
  OutageStatus,
  OutageType,
  UserRole,
} from '../../generated/prisma/enums';
import { writeAudit } from '../../shared/auditLog';
import { TTokenPayload } from '../../shared/jwt';
import prisma from '../../shared/prisma';
import {
  buildMeta,
  buildQueryOptions,
  buildSearchFilter,
} from '../../shared/queryBuilder';
import { cacheInvalidate } from '../../shared/redis';
import { queueNotifications } from '../notification/notification.service';

const SORTABLE = ['reportedAt', 'createdAt', 'severity', 'status'] as const;
const SEARCHABLE = ['title', 'description'] as const;

const outageSelect = {
  id: true,
  type: true,
  status: true,
  severity: true,
  title: true,
  description: true,
  photoUrl: true,
  affectedCustomers: true,
  reportedAt: true,
  acknowledgedAt: true,
  resolvedAt: true,
  restoredAt: true,
  downtimeMinutes: true,
  resolutionNote: true,
  createdAt: true,
  area: {
    select: {
      id: true,
      name: true,
      code: true,
      priorityTier: true,
      feeder: {
        select: {
          id: true,
          name: true,
          code: true,
          substation: {
            select: { id: true, name: true, zoneId: true },
          },
        },
      },
    },
  },
  reportedBy: { select: { id: true, name: true, phone: true } },
  assignments: {
    where: { status: { in: [AssignmentStatus.ASSIGNED, AssignmentStatus.ACCEPTED] } },
    select: {
      id: true,
      status: true,
      assignedAt: true,
      acceptedAt: true,
      technician: { select: { id: true, name: true, phone: true } },
    },
  },
};

type TActor = { userId: string; ip: string | null };

// ---------- OUTAGE STATE MACHINE ----------

/**
 * REPORTED -> ACKNOWLEDGED -> ASSIGNED -> IN_PROGRESS -> RESOLVED -> CLOSED
 * with CANCELLED reachable from any non-final state.
 *
 * Centralising the graph here means an invalid jump is rejected with a
 * clear 400 instead of silently corrupting the lifecycle.
 */
const ALLOWED_TRANSITIONS: Record<OutageStatus, OutageStatus[]> = {
  REPORTED: [OutageStatus.ACKNOWLEDGED, OutageStatus.ASSIGNED, OutageStatus.CANCELLED],
  ACKNOWLEDGED: [OutageStatus.ASSIGNED, OutageStatus.CANCELLED],
  ASSIGNED: [OutageStatus.IN_PROGRESS, OutageStatus.CANCELLED],
  IN_PROGRESS: [OutageStatus.RESOLVED, OutageStatus.CANCELLED],
  RESOLVED: [OutageStatus.CLOSED],
  CLOSED: [],
  CANCELLED: [],
};

export const assertTransition = (from: OutageStatus, to: OutageStatus): void => {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new AppError(
      400,
      `Cannot move an outage from ${from} to ${to}. Allowed next states: ${
        ALLOWED_TRANSITIONS[from].join(', ') || 'none (final state)'
      }`
    );
  }
};

// ---------- REPORT ----------

const report = async (
  payload: {
    areaId: string;
    title: string;
    description: string;
    severity?: OutageSeverity;
    photoUrl?: string;
  },
  actor: TActor
) => {
  const area = await prisma.area.findFirst({
    where: { id: payload.areaId, isDeleted: false },
    select: {
      id: true,
      name: true,
      feederId: true,
      _count: { select: { connections: true } },
    },
  });

  if (!area) throw new AppError(404, 'Area not found');

  const outage = await prisma.$transaction(async (tx) => {
    const created = await tx.outage.create({
      data: {
        type: OutageType.UNEXPECTED,
        areaId: payload.areaId,
        feederId: area.feederId,
        reportedById: actor.userId,
        title: payload.title,
        description: payload.description,
        severity: payload.severity ?? OutageSeverity.MEDIUM,
        photoUrl: payload.photoUrl,
        affectedCustomers: area._count.connections,
      },
      select: outageSelect,
    });

    // Every admin is told about a new unexpected outage so dispatch can
    // start without polling.
    const admins = await tx.user.findMany({
      where: { role: UserRole.ADMIN, isDeleted: false },
      select: { id: true },
    });

    await queueNotifications(
      tx,
      admins.map((admin) => ({
        userId: admin.id,
        type: NotificationType.OUTAGE_REPORTED,
        title: `New ${created.severity} outage in ${area.name}`,
        message: `${created.title} - ${area._count.connections} customer(s) affected.`,
        outageId: created.id,
      }))
    );

    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'OUTAGE_REPORTED',
      entityType: 'Outage',
      entityId: created.id,
      after: { areaId: payload.areaId, severity: created.severity },
      ipAddress: actor.ip,
    });

    return created;
  });

  await cacheInvalidate('analytics:*');

  return outage;
};

// ---------- READS ----------

const buildOutageWhere = (query: Record<string, unknown>): Prisma.OutageWhereInput => ({
  isDeleted: false,
  ...(query.status ? { status: query.status as OutageStatus } : {}),
  ...(query.severity ? { severity: query.severity as OutageSeverity } : {}),
  ...(query.type ? { type: query.type as OutageType } : {}),
  ...(query.areaId ? { areaId: String(query.areaId) } : {}),
  ...(query.feederId ? { feederId: String(query.feederId) } : {}),
  ...(query.zoneId
    ? { area: { feeder: { substation: { zoneId: String(query.zoneId) } } } }
    : {}),
  ...buildSearchFilter(
    typeof query.search === 'string' && query.search.trim()
      ? query.search.trim()
      : undefined,
    SEARCHABLE
  ),
});

const getAll = async (query: Record<string, unknown>) => {
  const { page, limit, skip, sortBy, sortOrder } = buildQueryOptions({
    query,
    sortableFields: SORTABLE,
    defaultSort: 'reportedAt',
  });

  const where = buildOutageWhere(query);

  const [data, total] = await Promise.all([
    prisma.outage.findMany({
      where,
      select: outageSelect,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.outage.count({ where }),
  ]);

  return { data, meta: buildMeta(page, limit, total) };
};

const getMyReports = async (userId: string, query: Record<string, unknown>) => {
  const { page, limit, skip, sortBy, sortOrder } = buildQueryOptions({
    query,
    sortableFields: SORTABLE,
    defaultSort: 'reportedAt',
  });

  const where = { ...buildOutageWhere(query), reportedById: userId };

  const [data, total] = await Promise.all([
    prisma.outage.findMany({
      where,
      select: outageSelect,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.outage.count({ where }),
  ]);

  return { data, meta: buildMeta(page, limit, total) };
};

const getMyAssignments = async (
  technicianId: string,
  query: Record<string, unknown>
) => {
  const { page, limit, skip } = buildQueryOptions({
    query,
    sortableFields: SORTABLE,
    defaultSort: 'reportedAt',
  });

  const where: Prisma.OutageWhereInput = {
    isDeleted: false,
    assignments: {
      some: {
        technicianId,
        status: { in: [AssignmentStatus.ASSIGNED, AssignmentStatus.ACCEPTED] },
      },
    },
    ...(query.status ? { status: query.status as OutageStatus } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.outage.findMany({
      where,
      select: outageSelect,
      skip,
      take: limit,
      orderBy: { reportedAt: 'desc' },
    }),
    prisma.outage.count({ where }),
  ]);

  return { data, meta: buildMeta(page, limit, total) };
};

const getById = async (id: string, user: TTokenPayload) => {
  const outage = await prisma.outage.findFirst({
    where: { id, isDeleted: false },
    select: {
      ...outageSelect,
      assignments: {
        select: {
          id: true,
          status: true,
          notes: true,
          assignedAt: true,
          acceptedAt: true,
          completedAt: true,
          technician: { select: { id: true, name: true, phone: true } },
          assignedBy: { select: { id: true, name: true } },
        },
        orderBy: { assignedAt: 'desc' },
      },
    },
  });

  if (!outage) throw new AppError(404, 'Outage not found');

  // Customers may only open outages they reported themselves.
  if (user.role === UserRole.CUSTOMER && outage.reportedBy?.id !== user.userId) {
    throw new AppError(403, 'You can only view outages you reported');
  }

  return outage;
};

// ---------- ACKNOWLEDGE ----------

const acknowledge = async (id: string, actor: TActor) => {
  const existing = await prisma.outage.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, status: true },
  });

  if (!existing) throw new AppError(404, 'Outage not found');

  assertTransition(existing.status, OutageStatus.ACKNOWLEDGED);

  const outage = await prisma.outage.update({
    where: { id },
    data: { status: OutageStatus.ACKNOWLEDGED, acknowledgedAt: new Date() },
    select: outageSelect,
  });

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'OUTAGE_ACKNOWLEDGED',
    entityType: 'Outage',
    entityId: id,
    before: { status: existing.status },
    after: { status: OutageStatus.ACKNOWLEDGED },
    ipAddress: actor.ip,
  });

  return outage;
};

// ---------- TECHNICIAN ASSIGNMENT (concurrency-guarded) ----------

const assign = async (
  outageId: string,
  technicianId: string,
  notes: string | undefined,
  actor: TActor
) => {
  const technician = await prisma.user.findFirst({
    where: { id: technicianId, isDeleted: false, role: UserRole.TECHNICIAN },
    select: {
      id: true,
      name: true,
      email: true,
      technicianProfile: {
        select: {
          id: true,
          isAvailable: true,
          activeJobCount: true,
          maxConcurrentJobs: true,
          zoneId: true,
        },
      },
    },
  });

  if (!technician) throw new AppError(404, 'Technician not found');

  const profile = technician.technicianProfile;
  if (!profile) {
    throw new AppError(400, 'This technician has no technician profile configured');
  }
  if (!profile.isAvailable) {
    throw new AppError(409, `${technician.name} is currently marked unavailable`);
  }
  if (profile.activeJobCount >= profile.maxConcurrentJobs) {
    throw new AppError(
      409,
      `${technician.name} already has ${profile.activeJobCount} active job(s), at the configured maximum`
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const outage = await tx.outage.findFirst({
      where: { id: outageId, isDeleted: false },
      select: {
        id: true,
        status: true,
        title: true,
        area: {
          select: {
            name: true,
            feeder: { select: { substation: { select: { zoneId: true } } } },
          },
        },
      },
    });

    if (!outage) throw new AppError(404, 'Outage not found');

    assertTransition(outage.status, OutageStatus.ASSIGNED);

    // A technician is scoped to their zone when one is configured.
    const outageZoneId = outage.area.feeder.substation.zoneId;
    if (profile.zoneId && profile.zoneId !== outageZoneId) {
      throw new AppError(
        409,
        `${technician.name} is assigned to a different distribution zone`
      );
    }

    // Compare-and-swap: the conditional updateMany only matches while the
    // outage is still unassigned. If two admins dispatch at the same moment
    // the loser gets count === 0 and is rejected, so one outage can never
    // be handed to two technicians.
    const claimed = await tx.outage.updateMany({
      where: {
        id: outageId,
        status: { in: [OutageStatus.REPORTED, OutageStatus.ACKNOWLEDGED] },
      },
      data: { status: OutageStatus.ASSIGNED },
    });

    if (claimed.count === 0) {
      throw new AppError(
        409,
        'This outage was already assigned by someone else. Refresh and try again'
      );
    }

    const assignment = await tx.outageAssignment.create({
      data: {
        outageId,
        technicianId,
        assignedById: actor.userId,
        notes,
        status: AssignmentStatus.ASSIGNED,
      },
      select: {
        id: true,
        status: true,
        assignedAt: true,
        notes: true,
        technician: { select: { id: true, name: true, phone: true } },
      },
    });

    await tx.technicianProfile.update({
      where: { id: profile.id },
      data: { activeJobCount: { increment: 1 } },
    });

    await queueNotifications(tx, [
      {
        userId: technicianId,
        type: NotificationType.OUTAGE_ASSIGNED,
        title: 'You have been assigned to an outage',
        message: `${outage.title} in ${outage.area.name}. Please respond as soon as possible.`,
        outageId,
      },
    ]);

    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'OUTAGE_ASSIGNED',
      entityType: 'Outage',
      entityId: outageId,
      before: { status: outage.status },
      after: { status: OutageStatus.ASSIGNED, technicianId },
      ipAddress: actor.ip,
    });

    return { assignment, technicianEmail: technician.email, outageTitle: outage.title };
  });

  return result;
};

// ---------- TECHNICIAN STATUS UPDATES ----------

const updateStatus = async (
  outageId: string,
  status: OutageStatus,
  note: string | undefined,
  user: TTokenPayload,
  ip: string | null
) => {
  const outage = await prisma.outage.findFirst({
    where: { id: outageId, isDeleted: false },
    select: {
      id: true,
      status: true,
      assignments: {
        where: {
          status: { in: [AssignmentStatus.ASSIGNED, AssignmentStatus.ACCEPTED] },
        },
        select: { id: true, technicianId: true },
      },
    },
  });

  if (!outage) throw new AppError(404, 'Outage not found');

  // A technician may only move outages they are actually on.
  if (user.role === UserRole.TECHNICIAN) {
    const isAssigned = outage.assignments.some((a) => a.technicianId === user.userId);
    if (!isAssigned) {
      throw new AppError(403, 'You are not assigned to this outage');
    }
  }

  assertTransition(outage.status, status);

  const updated = await prisma.$transaction(async (tx) => {
    // Moving to IN_PROGRESS also marks the assignment accepted.
    if (status === OutageStatus.IN_PROGRESS) {
      await tx.outageAssignment.updateMany({
        where: { outageId, status: AssignmentStatus.ASSIGNED },
        data: { status: AssignmentStatus.ACCEPTED, acceptedAt: new Date() },
      });
    }

    const row = await tx.outage.update({
      where: { id: outageId },
      data: {
        status,
        ...(note ? { resolutionNote: note } : {}),
      },
      select: outageSelect,
    });

    await writeAudit(tx, {
      actorId: user.userId,
      action: 'OUTAGE_STATUS_CHANGED',
      entityType: 'Outage',
      entityId: outageId,
      before: { status: outage.status },
      after: { status },
      ipAddress: ip,
    });

    return row;
  });

  return updated;
};

// ---------- RESTORATION ----------

const restore = async (
  outageId: string,
  note: string | undefined,
  user: TTokenPayload,
  ip: string | null
) => {
  const outage = await prisma.outage.findFirst({
    where: { id: outageId, isDeleted: false },
    select: {
      id: true,
      status: true,
      title: true,
      reportedAt: true,
      areaId: true,
      area: { select: { name: true } },
      assignments: {
        where: {
          status: { in: [AssignmentStatus.ASSIGNED, AssignmentStatus.ACCEPTED] },
        },
        select: { id: true, technicianId: true },
      },
    },
  });

  if (!outage) throw new AppError(404, 'Outage not found');

  if (user.role === UserRole.TECHNICIAN) {
    const isAssigned = outage.assignments.some((a) => a.technicianId === user.userId);
    if (!isAssigned) {
      throw new AppError(403, 'You are not assigned to this outage');
    }
  }

  assertTransition(outage.status, OutageStatus.RESOLVED);

  const restoredAt = new Date();
  // Persisted now so MTTR analytics is a plain average instead of a
  // per-row timestamp subtraction over the whole history table.
  const downtimeMinutes = Math.max(
    0,
    Math.round((restoredAt.getTime() - outage.reportedAt.getTime()) / 60000)
  );

  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.outage.update({
      where: { id: outageId },
      data: {
        status: OutageStatus.RESOLVED,
        resolvedAt: restoredAt,
        restoredAt,
        downtimeMinutes,
        resolutionNote: note,
      },
      select: outageSelect,
    });

    await tx.outageAssignment.updateMany({
      where: {
        outageId,
        status: { in: [AssignmentStatus.ASSIGNED, AssignmentStatus.ACCEPTED] },
      },
      data: { status: AssignmentStatus.COMPLETED, completedAt: restoredAt },
    });

    // Free the technicians up for the next dispatch.
    for (const assignment of outage.assignments) {
      await tx.technicianProfile.updateMany({
        where: { userId: assignment.technicianId, activeJobCount: { gt: 0 } },
        data: { activeJobCount: { decrement: 1 } },
      });
    }

    // Tell every customer in the affected area that power is back.
    const affected = await tx.connection.findMany({
      where: { areaId: outage.areaId, isDeleted: false },
      select: { customerId: true },
    });

    const notified = await queueNotifications(
      tx,
      affected.map((connection) => ({
        userId: connection.customerId,
        type: NotificationType.POWER_RESTORED,
        title: 'Power restored in your area',
        message: `${outage.area.name}: supply was restored after ${downtimeMinutes} minute(s).`,
        outageId,
      }))
    );

    await writeAudit(tx, {
      actorId: user.userId,
      action: 'OUTAGE_RESTORED',
      entityType: 'Outage',
      entityId: outageId,
      before: { status: outage.status },
      after: { status: OutageStatus.RESOLVED, downtimeMinutes },
      ipAddress: ip,
    });

    return { row, notified };
  });

  await cacheInvalidate('analytics:*');

  return {
    ...result.row,
    downtimeMinutes,
    customersNotified: result.notified,
  };
};

// ---------- SOFT DELETE ----------

const softDelete = async (id: string, actor: TActor) => {
  const existing = await prisma.outage.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, status: true },
  });

  if (!existing) throw new AppError(404, 'Outage not found');

  const outage = await prisma.outage.update({
    where: { id },
    data: { isDeleted: true },
    select: { id: true, status: true, isDeleted: true },
  });

  await writeAudit(prisma, {
    actorId: actor.userId,
    action: 'OUTAGE_DELETED',
    entityType: 'Outage',
    entityId: id,
    before: { isDeleted: false },
    after: { isDeleted: true },
    ipAddress: actor.ip,
  });

  return outage;
};

export const OutageService = {
  report,
  getAll,
  getMyReports,
  getMyAssignments,
  getById,
  acknowledge,
  assign,
  updateStatus,
  restore,
  softDelete,
};
