import AppError from '../../errors/AppError';
import { Prisma } from '../../generated/prisma/client';
import {
  BillStatus,
  OutageStatus,
  PaymentStatus,
  UserRole,
  UserStatus,
} from '../../generated/prisma/enums';
import { writeAudit } from '../../shared/auditLog';
import prisma from '../../shared/prisma';
import {
  buildMeta,
  buildQueryOptions,
  buildSearchFilter,
} from '../../shared/queryBuilder';
import { cacheGet, cacheSet, cacheInvalidate } from '../../shared/redis';

const USER_SORTABLE = ['name', 'email', 'createdAt'] as const;
const USER_SEARCHABLE = ['name', 'email', 'phone'] as const;
const AUDIT_SORTABLE = ['createdAt'] as const;
const CONTACT_SORTABLE = ['createdAt'] as const;
const CONTACT_SEARCHABLE = ['name', 'email', 'subject'] as const;

const DASHBOARD_CACHE_KEY = 'analytics:dashboard';
const DASHBOARD_TTL = 60;

type TActor = { userId: string; ip: string | null };

// ---------- USER MANAGEMENT ----------

const getUsers = async (query: Record<string, unknown>) => {
  const { page, limit, skip, sortBy, sortOrder, search } = buildQueryOptions({
    query,
    sortableFields: USER_SORTABLE,
  });

  const where: Prisma.UserWhereInput = {
    isDeleted: false,
    ...(query.role ? { role: query.role as UserRole } : {}),
    ...(query.status ? { status: query.status as UserStatus } : {}),
    ...buildSearchFilter(search, USER_SEARCHABLE),
  };

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      // password is never selected, on any code path.
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        avatarUrl: true,
        createdAt: true,
        _count: { select: { connections: true, reportedOutages: true } },
      },
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.user.count({ where }),
  ]);

  return { data, meta: buildMeta(page, limit, total) };
};

/**
 * Technicians with their live capacity, for the dispatch dialog. The
 * `canTakeJob` flag applies exactly the checks the assign endpoint enforces
 * (active account, available, below max jobs, same zone or unzoned), so the
 * UI can disable ineligible technicians instead of waiting for a 409.
 */
const getTechnicians = async (query: Record<string, unknown>) => {
  const zoneId = typeof query.zoneId === 'string' && query.zoneId ? query.zoneId : undefined;
  const search = typeof query.search === 'string' ? query.search.trim() : '';

  const technicians = await prisma.user.findMany({
    where: {
      isDeleted: false,
      role: UserRole.TECHNICIAN,
      technicianProfile: { isNot: null },
      ...buildSearchFilter(search || undefined, USER_SEARCHABLE),
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      avatarUrl: true,
      status: true,
      technicianProfile: {
        select: {
          specialization: true,
          isAvailable: true,
          activeJobCount: true,
          maxConcurrentJobs: true,
          zone: { select: { id: true, name: true, code: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
    take: 100,
  });

  const rows = technicians.map(({ technicianProfile, ...user }) => {
    // Guaranteed by the `isNot: null` filter above.
    const profile = technicianProfile!;
    const inZone = !zoneId || !profile.zone || profile.zone.id === zoneId;

    return {
      ...user,
      ...profile,
      inZone,
      canTakeJob:
        user.status === UserStatus.ACTIVE &&
        profile.isAvailable &&
        profile.activeJobCount < profile.maxConcurrentJobs &&
        inZone,
    };
  });

  const onlyAvailable = query.available === 'true';

  // Eligible technicians first, then by lightest workload.
  return rows
    .filter((row) => !onlyAvailable || row.canTakeJob)
    .sort(
      (a, b) =>
        Number(b.canTakeJob) - Number(a.canTakeJob) || a.activeJobCount - b.activeJobCount
    );
};

const updateRole =async (id: string, role: UserRole, actor: TActor) => {
  const existing = await prisma.user.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, name: true, role: true },
  });

  if (!existing) throw new AppError(404, 'User not found');

  if (existing.id === actor.userId) {
    throw new AppError(400, 'You cannot change your own role');
  }

  if (existing.role === role) {
    throw new AppError(400, `This user is already a ${role}`);
  }

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data: { role },
      select: { id: true, name: true, email: true, role: true, status: true },
    });

    // Promoting to TECHNICIAN needs a profile before they can be dispatched.
    if (role === UserRole.TECHNICIAN) {
      await tx.technicianProfile.upsert({
        where: { userId: id },
        create: { userId: id, specialization: 'General Maintenance' },
        update: { isAvailable: true },
      });
    }

    await writeAudit(tx, {
      actorId: actor.userId,
      action: 'USER_ROLE_CHANGED',
      entityType: 'User',
      entityId: id,
      before: { role: existing.role },
      after: { role },
      ipAddress: actor.ip,
    });

    return updated;
  });

  return user;
};

const updateStatus = async (id: string, status: UserStatus, actor: TActor) => {
  const existing = await prisma.user.findFirst({
    where: { id, isDeleted: false },
    select: { id: true, status: true, role: true },
  });

  if (!existing) throw new AppError(404, 'User not found');

  if (existing.id === actor.userId) {
    throw new AppError(400, 'You cannot change your own account status');
  }

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data: { status },
      select: { id: true, name: true, email: true, role: true, status: true },
    });

    // Banning revokes every active session immediately rather than waiting
    // for the access token to expire.
    if (status === UserStatus.BANNED) {
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await writeAudit(tx, {
      actorId: actor.userId,
      action: status === UserStatus.BANNED ? 'USER_BANNED' : 'USER_REINSTATED',
      entityType: 'User',
      entityId: id,
      before: { status: existing.status },
      after: { status },
      ipAddress: actor.ip,
    });

    return updated;
  });

  return user;
};

// ---------- DASHBOARD ----------

const getDashboardStats = async () => {
  const cached = await cacheGet<Record<string, unknown>>(DASHBOARD_CACHE_KEY);
  if (cached) return { ...cached, cached: true };

  const [
    usersByRole,
    outagesByStatus,
    activeOutages,
    zones,
    substations,
    feeders,
    areas,
    connections,
    billTotals,
    paymentTotals,
    activeSchedules,
    avgDowntime,
  ] = await Promise.all([
    prisma.user.groupBy({
      by: ['role'],
      where: { isDeleted: false },
      _count: { _all: true },
    }),
    prisma.outage.groupBy({
      by: ['status'],
      where: { isDeleted: false },
      _count: { _all: true },
    }),
    prisma.outage.count({
      where: {
        isDeleted: false,
        status: {
          in: [
            OutageStatus.REPORTED,
            OutageStatus.ACKNOWLEDGED,
            OutageStatus.ASSIGNED,
            OutageStatus.IN_PROGRESS,
          ],
        },
      },
    }),
    prisma.distributionZone.count({ where: { isDeleted: false } }),
    prisma.substation.count({ where: { isDeleted: false } }),
    prisma.feeder.count({ where: { isDeleted: false } }),
    prisma.area.count({ where: { isDeleted: false } }),
    prisma.connection.count({ where: { isDeleted: false } }),
    prisma.bill.groupBy({
      by: ['status'],
      where: { isDeleted: false },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    prisma.payment.aggregate({
      where: { status: PaymentStatus.COMPLETED },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.loadSheddingSchedule.count({
      where: { isDeleted: false, status: 'ACTIVE' },
    }),
    prisma.outage.aggregate({
      where: { isDeleted: false, downtimeMinutes: { not: null } },
      _avg: { downtimeMinutes: true },
    }),
  ]);

  const stats = {
    users: Object.fromEntries(usersByRole.map((r) => [r.role, r._count._all])),
    infrastructure: { zones, substations, feeders, areas, connections },
    outages: {
      byStatus: Object.fromEntries(
        outagesByStatus.map((r) => [r.status, r._count._all])
      ),
      currentlyOpen: activeOutages,
      averageRestorationMinutes: Math.round(avgDowntime._avg.downtimeMinutes ?? 0),
    },
    loadShedding: { activeSchedules },
    billing: {
      byStatus: Object.fromEntries(
        billTotals.map((r) => [
          r.status,
          {
            count: r._count._all,
            amount: Number((r._sum.totalAmount ?? 0).toFixed(2)),
          },
        ])
      ),
      unpaidAmount: Number(
        billTotals
          .filter(
            (r) => r.status === BillStatus.UNPAID || r.status === BillStatus.OVERDUE
          )
          .reduce((sum, r) => sum + (r._sum.totalAmount ?? 0), 0)
          .toFixed(2)
      ),
    },
    revenue: {
      completedPayments: paymentTotals._count._all,
      totalCollected: Number((paymentTotals._sum.amount ?? 0).toFixed(2)),
    },
    generatedAt: new Date().toISOString(),
  };

  await cacheSet(DASHBOARD_CACHE_KEY, stats, DASHBOARD_TTL);

  return { ...stats, cached: false };
};

// ---------- AUDIT LOGS ----------

const getAuditLogs = async (query: Record<string, unknown>) => {
  const { page, limit, skip, sortBy, sortOrder } = buildQueryOptions({
    query,
    sortableFields: AUDIT_SORTABLE,
  });

  const where: Prisma.AuditLogWhereInput = {
    ...(query.entityType ? { entityType: String(query.entityType) } : {}),
    ...(query.entityId ? { entityId: String(query.entityId) } : {}),
    ...(query.actorId ? { actorId: String(query.actorId) } : {}),
    ...(query.action ? { action: String(query.action) } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        before: true,
        after: true,
        ipAddress: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true, role: true } },
      },
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { data, meta: buildMeta(page, limit, total) };
};

// ---------- CONTACT INBOX ----------

const getContactMessages = async (query: Record<string, unknown>) => {
  const { page, limit, skip, sortBy, sortOrder, search } = buildQueryOptions({
    query,
    sortableFields: CONTACT_SORTABLE,
  });

  const where: Prisma.ContactMessageWhereInput = {
    ...(query.isRead === 'true' || query.isRead === 'false'
      ? { isRead: query.isRead === 'true' }
      : {}),
    ...buildSearchFilter(search, CONTACT_SEARCHABLE),
  };

  const [data, total] = await Promise.all([
    prisma.contactMessage.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        subject: true,
        message: true,
        isRead: true,
        readAt: true,
        createdAt: true,
      },
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.contactMessage.count({ where }),
  ]);

  return { data, meta: buildMeta(page, limit, total) };
};

const markContactRead = async (id: string) => {
  const message = await prisma.contactMessage.findUnique({
    where: { id },
    select: { id: true, isRead: true },
  });

  if (!message) throw new AppError(404, 'Contact message not found');

  if (message.isRead) return { id, alreadyRead: true };

  await prisma.contactMessage.update({
    where: { id },
    data: { isRead: true, readAt: new Date() },
  });

  return { id, alreadyRead: false };
};

/** Lets an admin drop the cached dashboard without waiting for the TTL. */
const clearCache = async () => {
  await cacheInvalidate('analytics:*');
  await cacheInvalidate('schedule:*');
  await cacheInvalidate('public:*');
  return { cleared: true };
};

export const AdminService = {
  getUsers,
  getTechnicians,
  updateRole,
  updateStatus,
  getDashboardStats,
  getAuditLogs,
  getContactMessages,
  markContactRead,
  clearCache,
};
