import { OutageStatus } from '../../generated/prisma/enums';
import prisma from '../../shared/prisma';
import { cacheGet, cacheSet } from '../../shared/redis';

const ANALYTICS_TTL = 120;

type TDateRange = { from?: string; to?: string };

const rangeFilter = (range: TDateRange) => {
  if (!range.from && !range.to) return {};
  return {
    reportedAt: {
      ...(range.from ? { gte: new Date(range.from) } : {}),
      ...(range.to ? { lte: new Date(range.to) } : {}),
    },
  };
};

/**
 * Historical outage analytics: MTTR, volume by status/severity, the worst
 * affected areas, and a month-by-month trend.
 *
 * Aggregation is pushed into Postgres (groupBy / aggregate / raw SQL for
 * the date bucket) rather than pulling rows into Node and reducing them,
 * so the work stays proportional to the result size, not the table size.
 */
const getOutageAnalytics = async (range: TDateRange) => {
  const cacheKey = `analytics:outages:${range.from ?? 'all'}:${range.to ?? 'all'}`;
  const cached = await cacheGet<Record<string, unknown>>(cacheKey);
  if (cached) return { ...cached, cached: true };

  const where = { isDeleted: false, ...rangeFilter(range) };

  const [byStatus, bySeverity, byType, mttr, topAreas, monthly, resolvedCount] =
    await Promise.all([
      prisma.outage.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      prisma.outage.groupBy({
        by: ['severity'],
        where,
        _count: { _all: true },
      }),
      prisma.outage.groupBy({
        by: ['type'],
        where,
        _count: { _all: true },
      }),
      prisma.outage.aggregate({
        where: { ...where, downtimeMinutes: { not: null } },
        _avg: { downtimeMinutes: true },
        _min: { downtimeMinutes: true },
        _max: { downtimeMinutes: true },
      }),
      prisma.outage.groupBy({
        by: ['areaId'],
        where,
        _count: { _all: true },
        _avg: { downtimeMinutes: true },
        orderBy: { _count: { areaId: 'desc' } },
        take: 5,
      }),
      prisma.$queryRaw<{ month: string; count: bigint; avg_downtime: number | null }[]>`
        SELECT to_char(date_trunc('month', "reportedAt"), 'YYYY-MM') AS month,
               COUNT(*)                                              AS count,
               AVG("downtimeMinutes")                                AS avg_downtime
        FROM outages
        WHERE "isDeleted" = false
        GROUP BY 1
        ORDER BY 1 DESC
        LIMIT 12
      `,
      prisma.outage.count({
        where: {
          ...where,
          status: { in: [OutageStatus.RESOLVED, OutageStatus.CLOSED] },
        },
      }),
    ]);

  // Resolve the top area ids to names in one extra query rather than N.
  const areaNames = await prisma.area.findMany({
    where: { id: { in: topAreas.map((a) => a.areaId) } },
    select: {
      id: true,
      name: true,
      code: true,
      feeder: {
        select: { substation: { select: { zone: { select: { name: true } } } } },
      },
    },
  });
  const areaById = new Map(areaNames.map((a) => [a.id, a]));

  const total = byStatus.reduce((sum, row) => sum + row._count._all, 0);

  const result = {
    totalOutages: total,
    resolvedOutages: resolvedCount,
    resolutionRate: total ? Number(((resolvedCount / total) * 100).toFixed(1)) : 0,
    meanTimeToRestoreMinutes: Math.round(mttr._avg.downtimeMinutes ?? 0),
    fastestRestorationMinutes: mttr._min.downtimeMinutes ?? null,
    slowestRestorationMinutes: mttr._max.downtimeMinutes ?? null,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    bySeverity: Object.fromEntries(bySeverity.map((r) => [r.severity, r._count._all])),
    byType: Object.fromEntries(byType.map((r) => [r.type, r._count._all])),
    topAffectedAreas: topAreas.map((row) => {
      const area = areaById.get(row.areaId);
      return {
        areaId: row.areaId,
        area: area?.name ?? 'Unknown',
        code: area?.code ?? null,
        zone: area?.feeder.substation.zone.name ?? null,
        outages: row._count._all,
        averageDowntimeMinutes: Math.round(row._avg.downtimeMinutes ?? 0),
      };
    }),
    monthlyTrend: monthly.map((row) => ({
      month: row.month,
      outages: Number(row.count),
      averageDowntimeMinutes: Math.round(row.avg_downtime ?? 0),
    })),
    generatedAt: new Date().toISOString(),
  };

  await cacheSet(cacheKey, result, ANALYTICS_TTL);

  return { ...result, cached: false };
};

/** Load-shedding hours per zone and per feeder, plus protection coverage. */
const getLoadSheddingAnalytics = async (range: TDateRange) => {
  const cacheKey = `analytics:shedding:${range.from ?? 'all'}:${range.to ?? 'all'}`;
  const cached = await cacheGet<Record<string, unknown>>(cacheKey);
  if (cached) return { ...cached, cached: true };

  const dateWhere =
    range.from || range.to
      ? {
          date: {
            ...(range.from ? { gte: new Date(range.from) } : {}),
            ...(range.to ? { lte: new Date(range.to) } : {}),
          },
        }
      : {};

  const [byZone, byFeeder, byStatus, protectedAreas] = await Promise.all([
    prisma.$queryRaw<{ zone: string; slots: bigint; hours: number | null }[]>`
      SELECT z.name                                                            AS zone,
             COUNT(*)                                                          AS slots,
             SUM(EXTRACT(EPOCH FROM (s."endTime" - s."startTime")) / 3600)      AS hours
      FROM load_shedding_schedules s
      JOIN feeders f     ON f.id = s."feederId"
      JOIN substations ss ON ss.id = f."substationId"
      JOIN distribution_zones z ON z.id = ss."zoneId"
      WHERE s."isDeleted" = false
      GROUP BY z.name
      ORDER BY hours DESC NULLS LAST
    `,
    prisma.$queryRaw<
      { feeder: string; code: string; slots: bigint; hours: number | null }[]
    >`
      SELECT f.name                                                        AS feeder,
             f.code                                                        AS code,
             COUNT(*)                                                      AS slots,
             SUM(EXTRACT(EPOCH FROM (s."endTime" - s."startTime")) / 3600) AS hours
      FROM load_shedding_schedules s
      JOIN feeders f ON f.id = s."feederId"
      WHERE s."isDeleted" = false
      GROUP BY f.name, f.code
      ORDER BY hours DESC NULLS LAST
      LIMIT 10
    `,
    prisma.loadSheddingSchedule.groupBy({
      by: ['status'],
      where: { isDeleted: false, ...dateWhere },
      _count: { _all: true },
    }),
    prisma.area.count({
      where: { isDeleted: false, priorityTier: 'CRITICAL' },
    }),
  ]);

  const result = {
    byZone: byZone.map((row) => ({
      zone: row.zone,
      slots: Number(row.slots),
      totalHours: Number((row.hours ?? 0).toFixed(2)),
    })),
    mostShedFeeders: byFeeder.map((row) => ({
      feeder: row.feeder,
      code: row.code,
      slots: Number(row.slots),
      totalHours: Number((row.hours ?? 0).toFixed(2)),
    })),
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    criticalAreasProtected: protectedAreas,
    generatedAt: new Date().toISOString(),
  };

  await cacheSet(cacheKey, result, ANALYTICS_TTL);

  return { ...result, cached: false };
};

/** Per-technician workload and average restoration time. */
const getTechnicianPerformance = async () => {
  const rows = await prisma.$queryRaw<
    {
      technician: string;
      email: string;
      completed: bigint;
      avg_downtime: number | null;
    }[]
  >`
    SELECT u.name                  AS technician,
           u.email                 AS email,
           COUNT(a.id)             AS completed,
           AVG(o."downtimeMinutes") AS avg_downtime
    FROM outage_assignments a
    JOIN users u   ON u.id = a."technicianId"
    JOIN outages o ON o.id = a."outageId"
    WHERE a.status = 'COMPLETED'
    GROUP BY u.name, u.email
    ORDER BY completed DESC
    LIMIT 20
  `;

  return rows.map((row) => ({
    technician: row.technician,
    email: row.email,
    jobsCompleted: Number(row.completed),
    averageRestorationMinutes: Math.round(row.avg_downtime ?? 0),
  }));
};

export const AnalyticsService = {
  getOutageAnalytics,
  getLoadSheddingAnalytics,
  getTechnicianPerformance,
};
