import { Prisma } from '../../generated/prisma/client';
import {
  ConnectionStatus,
  OutageStatus,
  PriorityTier,
  ScheduleStatus,
} from '../../generated/prisma/enums';
import { sendEmail } from '../../shared/mailer';
import prisma from '../../shared/prisma';
import { buildMeta } from '../../shared/queryBuilder';
import { cacheGet, cacheSet } from '../../shared/redis';

/**
 * Read-only data for the public website. Everything here is information a
 * utility already publishes (network size, the day's load-shedding slots),
 * so no personal data - customers, reporters, technicians - is ever selected.
 */

const STATS_CACHE_KEY = 'public:stats';
const STATS_TTL = 120;
const ZONES_CACHE_KEY = 'public:zones';
const ZONES_TTL = 600;

/** YYYY-MM-DD for "today" in UTC, matching how schedule dates are stored. */
const todayUtc = (): string => new Date().toISOString().slice(0, 10);

const getStats = async () => {
  const cached = await cacheGet<Record<string, unknown>>(STATS_CACHE_KEY);
  if (cached) return { ...cached, cached: true };

  const today = new Date(`${todayUtc()}T00:00:00.000Z`);

  const [
    zones,
    substations,
    feeders,
    areas,
    criticalAreas,
    activeConnections,
    schedulesToday,
    activeSheddingNow,
    openOutages,
    restored,
  ] = await Promise.all([
    prisma.distributionZone.count({ where: { isDeleted: false } }),
    prisma.substation.count({ where: { isDeleted: false } }),
    prisma.feeder.count({ where: { isDeleted: false } }),
    prisma.area.count({ where: { isDeleted: false } }),
    prisma.area.count({
      where: { isDeleted: false, priorityTier: PriorityTier.CRITICAL },
    }),
    prisma.connection.count({
      where: { isDeleted: false, status: ConnectionStatus.ACTIVE },
    }),
    prisma.loadSheddingSchedule.count({
      where: {
        isDeleted: false,
        date: today,
        status: { not: ScheduleStatus.CANCELLED },
      },
    }),
    prisma.loadSheddingSchedule.count({
      where: { isDeleted: false, status: ScheduleStatus.ACTIVE },
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
    prisma.outage.aggregate({
      where: {
        isDeleted: false,
        status: { in: [OutageStatus.RESOLVED, OutageStatus.CLOSED] },
      },
      _count: { _all: true },
      _avg: { downtimeMinutes: true },
    }),
  ]);

  const stats = {
    network: { zones, substations, feeders, areas, criticalAreas },
    customersServed: activeConnections,
    loadShedding: { schedulesToday, activeNow: activeSheddingNow },
    outages: {
      open: openOutages,
      restored: restored._count._all,
      meanTimeToRestoreMinutes: Math.round(restored._avg.downtimeMinutes ?? 0),
    },
    generatedAt: new Date().toISOString(),
  };

  await cacheSet(STATS_CACHE_KEY, stats, STATS_TTL);

  return { ...stats, cached: false };
};

const getZones = async () => {
  const cached = await cacheGet<unknown[]>(ZONES_CACHE_KEY);
  if (cached) return cached;

  const zones = await prisma.distributionZone.findMany({
    where: { isDeleted: false },
    select: {
      id: true,
      name: true,
      code: true,
      city: true,
      district: true,
      _count: { select: { substations: { where: { isDeleted: false } } } },
    },
    orderBy: { name: 'asc' },
  });

  await cacheSet(ZONES_CACHE_KEY, zones, ZONES_TTL);

  return zones;
};

/**
 * The published load-shedding timetable for one day. `search` matches the
 * feeder or any area it serves, which is how a resident answers "is my
 * neighbourhood affected today?".
 */
const getSchedules = async (query: {
  zoneId?: string;
  date?: string;
  search?: string;
  page?: number;
  limit?: number;
}) => {
  const page = query.page ?? 1;
  const limit = query.limit ?? 10;
  const date = query.date ?? todayUtc();

  const feederFilter: Prisma.FeederWhereInput = {
    ...(query.zoneId ? { substation: { zoneId: query.zoneId } } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
            {
              areas: {
                some: {
                  isDeleted: false,
                  name: { contains: query.search, mode: 'insensitive' },
                },
              },
            },
          ],
        }
      : {}),
  };

  const where: Prisma.LoadSheddingScheduleWhereInput = {
    isDeleted: false,
    date: new Date(`${date}T00:00:00.000Z`),
    status: { not: ScheduleStatus.CANCELLED },
    feeder: feederFilter,
  };

  const [data, total] = await Promise.all([
    prisma.loadSheddingSchedule.findMany({
      where,
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        reason: true,
        status: true,
        feeder: {
          select: {
            id: true,
            name: true,
            code: true,
            voltageLevel: true,
            areas: {
              where: { isDeleted: false },
              select: { id: true, name: true, priorityTier: true },
              orderBy: { name: 'asc' },
            },
            substation: {
              select: {
                id: true,
                name: true,
                zone: { select: { id: true, name: true, code: true } },
              },
            },
          },
        },
      },
      orderBy: [{ startTime: 'asc' }, { feeder: { name: 'asc' } }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.loadSheddingSchedule.count({ where }),
  ]);

  return { data, meta: { ...buildMeta(page, limit, total), date } };
};

const submitContact = async (
  payload: { name: string; email: string; phone?: string; subject: string; message: string },
  ip: string | null
) => {
  const saved = await prisma.contactMessage.create({
    data: { ...payload, ipAddress: ip },
    select: { id: true, name: true, email: true, subject: true, createdAt: true },
  });

  // Acknowledgement to the sender; logged to the console when SMTP is unset.
  await sendEmail({
    to: payload.email,
    subject: `PowerGrid BD - we received your message: ${payload.subject}`,
    text: `Dear ${payload.name}, thank you for contacting PowerGrid BD. Our support team will reply within one working day. Reference: ${saved.id}.`,
  });

  return saved;
};

export const PublicService = { getStats, getZones, getSchedules, submitContact };
