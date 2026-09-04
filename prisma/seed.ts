/**
 * Seeds a complete, demonstrable dataset:
 * 3 zones -> 6 substations -> 12 feeders -> 24 areas -> 40 connections,
 * plus users for all three roles, two months of bills (some overdue),
 * a week of load-shedding slots and outages in every lifecycle state.
 *
 * Re-runnable: it truncates the domain tables first, so `npm run seed`
 * always produces the same known-good demo state.
 */
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  AssignmentStatus,
  BillStatus,
  ConnectionType,
  NotificationType,
  OutageSeverity,
  OutageStatus,
  OutageType,
  PriorityTier,
  ScheduleStatus,
  SubstationStatus,
  UserRole,
} from '../src/generated/prisma/enums';

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL or DIRECT_URL must be set to seed the database');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const DEMO_PASSWORD = 'Admin@1234';
const CUSTOMER_PASSWORD = 'Customer@1234';
const TECH_PASSWORD = 'Tech@1234';

const round2 = (n: number): number => Math.round(n * 100) / 100;

const daysFromNow = (days: number): Date => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const slotOn = (date: Date, hour: number, durationHours: number) => {
  const start = new Date(date);
  start.setUTCHours(hour, 0, 0, 0);
  const end = new Date(start);
  end.setUTCHours(hour + durationHours);
  return { start, end };
};

const ZONES = [
  { name: 'Dhaka North', code: 'DHK-N', city: 'Dhaka', district: 'Dhaka' },
  { name: 'Dhaka South', code: 'DHK-S', city: 'Dhaka', district: 'Dhaka' },
  { name: 'Chattogram Metro', code: 'CTG-M', city: 'Chattogram', district: 'Chattogram' },
];

const AREA_NAMES = [
  ['Mirpur 10', 'Mirpur 12', 'Pallabi', 'Kazipara'],
  ['Uttara Sector 4', 'Uttara Sector 7', 'Airport Road', 'Nikunja'],
  ['Dhanmondi 27', 'Dhanmondi 32', 'Jigatola', 'Hazaribagh'],
  ['Motijheel', 'Paltan', 'Gulistan', 'Wari'],
  ['Agrabad', 'Halishahar', 'Pahartali', 'Khulshi'],
  ['Chawkbazar CTG', 'Bakalia', 'Kotwali', 'Patenga'],
];

const clearDatabase = async (): Promise<void> => {
  // Ordered child-to-parent so foreign keys never block the reset.
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.bill.deleteMany();
  await prisma.outageAssignment.deleteMany();
  await prisma.outage.deleteMany();
  await prisma.loadSheddingSchedule.deleteMany();
  await prisma.connection.deleteMany();
  await prisma.area.deleteMany();
  await prisma.feeder.deleteMany();
  await prisma.substation.deleteMany();
  await prisma.technicianProfile.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.distributionZone.deleteMany();
  await prisma.user.deleteMany();
};

const main = async (): Promise<void> => {
  console.log('[seed] clearing existing data...');
  await clearDatabase();

  // ---------- USERS ----------
  const [adminHash, customerHash, techHash] = await Promise.all([
    bcrypt.hash(DEMO_PASSWORD, 12),
    bcrypt.hash(CUSTOMER_PASSWORD, 12),
    bcrypt.hash(TECH_PASSWORD, 12),
  ]);

  const admin = await prisma.user.create({
    data: {
      name: 'Grid Administrator',
      email: 'admin@powergrid.bd',
      password: adminHash,
      phone: '01700000001',
      address: 'BPDB HQ, Motijheel, Dhaka',
      role: UserRole.ADMIN,
    },
  });

  const secondAdmin = await prisma.user.create({
    data: {
      name: 'Operations Admin',
      email: 'ops@powergrid.bd',
      password: adminHash,
      phone: '01700000002',
      role: UserRole.ADMIN,
    },
  });

  console.log('[seed] created 2 admins');

  // ---------- ZONES / SUBSTATIONS / FEEDERS / AREAS ----------
  const zones = [];
  for (const zone of ZONES) {
    zones.push(await prisma.distributionZone.create({ data: zone }));
  }

  const feeders: { id: string; areaIds: string[]; zoneId: string }[] = [];
  const areas: { id: string; name: string; tier: PriorityTier; feederId: string }[] = [];
  let areaGroup = 0;

  for (const [zi, zone] of zones.entries()) {
    for (let s = 0; s < 2; s += 1) {
      const substation = await prisma.substation.create({
        data: {
          name: `${zone.name} Substation ${s + 1}`,
          code: `SS-${zone.code}-${s + 1}`,
          zoneId: zone.id,
          capacityMva: 40 + s * 15,
          status: s === 1 && zi === 2 ? SubstationStatus.MAINTENANCE : SubstationStatus.OPERATIONAL,
        },
      });

      for (let f = 0; f < 2; f += 1) {
        const names = AREA_NAMES[areaGroup % AREA_NAMES.length];
        const feeder = await prisma.feeder.create({
          data: {
            name: `${names[0]} Feeder`,
            code: `FD-${zone.code}-${s + 1}${f + 1}`,
            substationId: substation.id,
            voltageLevel: f === 0 ? '11kV' : '33kV',
            loadKw: 800 + ((areaGroup * 137) % 900),
          },
        });

        const feederAreaIds: string[] = [];
        for (const [ai, areaName] of names.entries()) {
          // One CRITICAL area per zone (a hospital feeder) so the
          // protection rule is visible in the demo.
          const tier =
            areaGroup % 6 === 0 && ai === 0
              ? PriorityTier.CRITICAL
              : ai === 1
                ? PriorityTier.HIGH
                : ai === 2
                  ? PriorityTier.NORMAL
                  : PriorityTier.LOW;

          const area = await prisma.area.create({
            data: {
              name: areaName,
              code: `AR-${zone.code}-${areaGroup}${ai}`,
              feederId: feeder.id,
              population: 15000 + ((areaGroup + ai) * 3700) % 60000,
              priorityTier: tier,
            },
          });

          feederAreaIds.push(area.id);
          areas.push({ id: area.id, name: area.name, tier, feederId: feeder.id });
        }

        feeders.push({ id: feeder.id, areaIds: feederAreaIds, zoneId: zone.id });
        areaGroup += 1;
      }
    }
  }

  console.log(
    `[seed] created ${zones.length} zones, ${zones.length * 2} substations, ${feeders.length} feeders, ${areas.length} areas`
  );

  // ---------- TECHNICIANS ----------
  const technicians = [];
  const specializations = [
    'Line Repair',
    'Transformer Maintenance',
    'Substation Electrical',
    'Underground Cabling',
  ];

  for (let i = 0; i < 4; i += 1) {
    const technician = await prisma.user.create({
      data: {
        name: ['Rafiqul Islam', 'Kamrul Hasan', 'Shahin Alam', 'Jahangir Kabir'][i],
        email: `tech${i + 1}@powergrid.bd`,
        password: techHash,
        phone: `018000000${i + 10}`,
        role: UserRole.TECHNICIAN,
        technicianProfile: {
          create: {
            specialization: specializations[i],
            isAvailable: true,
            maxConcurrentJobs: 3,
            zoneId: zones[i % zones.length].id,
          },
        },
      },
    });
    technicians.push(technician);
  }

  console.log('[seed] created 4 technicians');

  // ---------- CUSTOMERS + CONNECTIONS ----------
  const customerNames = [
    'Ayesha Rahman', 'Tanvir Ahmed', 'Nusrat Jahan', 'Sabbir Hossain',
    'Farhana Akter', 'Imran Chowdhury', 'Mitu Sultana', 'Rakib Uddin',
    'Sharmin Nahar', 'Arif Mahmud',
  ];

  const customers = [];
  const connections = [];

  for (const [i, name] of customerNames.entries()) {
    const customer = await prisma.user.create({
      data: {
        name,
        email: `customer${i + 1}@powergrid.bd`,
        password: customerHash,
        phone: `017${String(10000000 + i * 1111).slice(0, 8)}`,
        address: `House ${10 + i}, Road ${3 + (i % 8)}, Dhaka`,
        role: UserRole.CUSTOMER,
      },
    });
    customers.push(customer);

    // Most customers get one meter; every fourth gets a second one.
    const meterCount = i % 4 === 0 ? 2 : 1;
    for (let m = 0; m < meterCount; m += 1) {
      const area = areas[(i * 2 + m) % areas.length];
      const type =
        i % 5 === 0
          ? ConnectionType.COMMERCIAL
          : i % 7 === 0
            ? ConnectionType.INDUSTRIAL
            : ConnectionType.RESIDENTIAL;

      connections.push(
        await prisma.connection.create({
          data: {
            meterNo: `MTR-${String(100001 + connections.length)}`,
            customerId: customer.id,
            areaId: area.id,
            connectionType: type,
            tariffRate: type === ConnectionType.INDUSTRIAL ? 9.2 : type === ConnectionType.COMMERCIAL ? 8.4 : 7.5,
          },
        })
      );
    }
  }

  console.log(`[seed] created ${customers.length} customers with ${connections.length} connections`);

  // ---------- BILLS (two months, some overdue) ----------
  const periods = [
    { period: '2026-07', due: daysFromNow(-20), overdue: true },
    { period: '2026-08', due: daysFromNow(12), overdue: false },
  ];

  let billCount = 0;
  for (const { period, due, overdue } of periods) {
    for (const connection of connections) {
      const units = 120 + ((connection.meterNo.charCodeAt(9) * 7) % 200);
      const amount = round2(units * connection.tariffRate);
      const lateFee = overdue ? round2(amount * 0.05) : 0;

      await prisma.bill.create({
        data: {
          customerId: connection.customerId,
          connectionId: connection.id,
          billingPeriod: period,
          unitsConsumed: units,
          tariffRate: connection.tariffRate,
          amount,
          lateFee,
          totalAmount: round2(amount + lateFee),
          dueDate: due,
          status: overdue ? BillStatus.OVERDUE : BillStatus.UNPAID,
        },
      });
      billCount += 1;
    }
  }

  console.log(`[seed] created ${billCount} bills`);

  // ---------- LOAD-SHEDDING SCHEDULES ----------
  let scheduleCount = 0;
  for (let day = 0; day < 5; day += 1) {
    const date = daysFromNow(day);
    // Two feeders shed per day, in non-overlapping slots.
    for (let i = 0; i < 2; i += 1) {
      const feeder = feeders[(day * 2 + i) % feeders.length];
      const { start, end } = slotOn(date, 10 + i * 3, 2);

      await prisma.loadSheddingSchedule.create({
        data: {
          feederId: feeder.id,
          date,
          startTime: start,
          endTime: end,
          reason: day === 0 ? 'National grid deficit' : 'Scheduled maintenance',
          status: day === 0 ? ScheduleStatus.ACTIVE : ScheduleStatus.PLANNED,
          isAutoGenerated: day > 1,
          createdById: admin.id,
        },
      });
      scheduleCount += 1;
    }
  }

  console.log(`[seed] created ${scheduleCount} load-shedding schedules`);

  // ---------- OUTAGES ACROSS EVERY LIFECYCLE STATE ----------
  const outageSpecs: {
    status: OutageStatus;
    severity: OutageSeverity;
    title: string;
    description: string;
    daysAgo: number;
    downtime?: number;
    technicianIndex?: number;
  }[] = [
    {
      status: OutageStatus.REPORTED,
      severity: OutageSeverity.HIGH,
      title: 'Transformer sparking near the main road',
      description: 'Loud bang followed by complete darkness across the block.',
      daysAgo: 0,
    },
    {
      status: OutageStatus.ACKNOWLEDGED,
      severity: OutageSeverity.MEDIUM,
      title: 'Partial power loss in three buildings',
      description: 'Only one phase appears to be live since this morning.',
      daysAgo: 1,
    },
    {
      status: OutageStatus.ASSIGNED,
      severity: OutageSeverity.CRITICAL,
      title: 'Snapped 11kV overhead line after storm',
      description: 'Live conductor down on the street, area cordoned off.',
      daysAgo: 1,
      technicianIndex: 0,
    },
    {
      status: OutageStatus.IN_PROGRESS,
      severity: OutageSeverity.HIGH,
      title: 'Feeder tripping repeatedly since midnight',
      description: 'Power returns for a few minutes then trips again.',
      daysAgo: 2,
      technicianIndex: 1,
    },
    {
      status: OutageStatus.RESOLVED,
      severity: OutageSeverity.MEDIUM,
      title: 'Blown fuse on distribution pole',
      description: 'Half the lane lost supply after a loud pop.',
      daysAgo: 4,
      downtime: 145,
      technicianIndex: 2,
    },
    {
      status: OutageStatus.CLOSED,
      severity: OutageSeverity.LOW,
      title: 'Flickering street lighting circuit',
      description: 'Street lights dimming intermittently after 9pm.',
      daysAgo: 9,
      downtime: 260,
      technicianIndex: 3,
    },
    {
      status: OutageStatus.RESOLVED,
      severity: OutageSeverity.CRITICAL,
      title: 'Substation breaker failure',
      description: 'Whole area without power after a breaker fault.',
      daysAgo: 15,
      downtime: 420,
      technicianIndex: 0,
    },
    {
      status: OutageStatus.CANCELLED,
      severity: OutageSeverity.LOW,
      title: 'Reported outage was a private wiring fault',
      description: 'Customer main switch had tripped, grid supply was normal.',
      daysAgo: 6,
    },
  ];

  for (const [i, spec] of outageSpecs.entries()) {
    const area = areas[(i * 3) % areas.length];
    const reporter = customers[i % customers.length];
    const reportedAt = new Date(Date.now() - spec.daysAgo * 86400000);

    const resolvedAt =
      spec.downtime !== undefined
        ? new Date(reportedAt.getTime() + spec.downtime * 60000)
        : null;

    const outage = await prisma.outage.create({
      data: {
        type: OutageType.UNEXPECTED,
        areaId: area.id,
        feederId: area.feederId,
        reportedById: reporter.id,
        status: spec.status,
        severity: spec.severity,
        title: spec.title,
        description: spec.description,
        affectedCustomers: 30 + i * 17,
        reportedAt,
        acknowledgedAt:
          spec.status === OutageStatus.REPORTED
            ? null
            : new Date(reportedAt.getTime() + 15 * 60000),
        resolvedAt,
        restoredAt: resolvedAt,
        downtimeMinutes: spec.downtime ?? null,
        resolutionNote: resolvedAt ? 'Fault cleared and supply normalised.' : null,
      },
    });

    if (spec.technicianIndex !== undefined) {
      const technician = technicians[spec.technicianIndex];
      const isDone =
        spec.status === OutageStatus.RESOLVED || spec.status === OutageStatus.CLOSED;

      await prisma.outageAssignment.create({
        data: {
          outageId: outage.id,
          technicianId: technician.id,
          assignedById: admin.id,
          status: isDone
            ? AssignmentStatus.COMPLETED
            : spec.status === OutageStatus.IN_PROGRESS
              ? AssignmentStatus.ACCEPTED
              : AssignmentStatus.ASSIGNED,
          assignedAt: new Date(reportedAt.getTime() + 20 * 60000),
          acceptedAt:
            spec.status === OutageStatus.ASSIGNED
              ? null
              : new Date(reportedAt.getTime() + 35 * 60000),
          completedAt: resolvedAt,
          notes: 'Dispatched from the control room.',
        },
      });

      // Keep the denormalised counter consistent with the open jobs above.
      if (!isDone) {
        await prisma.technicianProfile.update({
          where: { userId: technician.id },
          data: { activeJobCount: { increment: 1 } },
        });
      }
    }

    await prisma.notification.create({
      data: {
        userId: reporter.id,
        type:
          spec.status === OutageStatus.RESOLVED || spec.status === OutageStatus.CLOSED
            ? NotificationType.POWER_RESTORED
            : NotificationType.OUTAGE_REPORTED,
        title:
          spec.status === OutageStatus.RESOLVED || spec.status === OutageStatus.CLOSED
            ? 'Power restored in your area'
            : 'We received your outage report',
        message: `${area.name}: ${spec.title}`,
        outageId: outage.id,
        isRead: i % 3 === 0,
      },
    });
  }

  console.log(`[seed] created ${outageSpecs.length} outages across every lifecycle state`);

  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      action: 'DATABASE_SEEDED',
      entityType: 'System',
      entityId: 'seed',
      after: {
        zones: zones.length,
        feeders: feeders.length,
        areas: areas.length,
        customers: customers.length,
        connections: connections.length,
        bills: billCount,
      },
    },
  });

  console.log('\n[seed] done. Demo credentials:');
  console.table([
    { role: 'ADMIN', email: 'admin@powergrid.bd', password: DEMO_PASSWORD },
    { role: 'TECHNICIAN', email: 'tech1@powergrid.bd', password: TECH_PASSWORD },
    { role: 'CUSTOMER', email: 'customer1@powergrid.bd', password: CUSTOMER_PASSWORD },
  ]);
  void secondAdmin;
};

main()
  .catch((error) => {
    console.error('[seed] failed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
