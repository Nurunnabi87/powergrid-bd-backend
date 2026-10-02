import AppError from '../../errors/AppError';
import { writeAudit } from '../../shared/auditLog';
import prisma from '../../shared/prisma';

const profileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  address: true,
  avatarUrl: true,
  role: true,
  status: true,
  createdAt: true,
  technicianProfile: {
    select: {
      id: true,
      specialization: true,
      isAvailable: true,
      activeJobCount: true,
      maxConcurrentJobs: true,
      zone: { select: { id: true, name: true, code: true } },
    },
  },
} as const;

const getMe = async (userId: string) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, isDeleted: false },
    select: profileSelect,
  });

  if (!user) throw new AppError(404, 'User not found');

  return user;
};

const updateMe = async (
  userId: string,
  payload: Partial<{ name: string; phone: string; address: string }>,
  ip: string | null
) => {
  const existing = await prisma.user.findFirst({
    where: { id: userId, isDeleted: false },
    select: { id: true, name: true, phone: true, address: true },
  });

  if (!existing) throw new AppError(404, 'User not found');

  // Email and role are deliberately absent from the update surface: an
  // email change would bypass ownership checks and a role change is an
  // admin-only operation.
  const user = await prisma.user.update({
    where: { id: userId },
    data: payload,
    select: profileSelect,
  });

  await writeAudit(prisma, {
    actorId: userId,
    action: 'PROFILE_UPDATED',
    entityType: 'User',
    entityId: userId,
    before: existing,
    after: payload,
    ipAddress: ip,
  });

  return user;
};

const updateAvatar = async (userId: string, avatarUrl: string) => {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl },
    select: { id: true, name: true, avatarUrl: true },
  });

  return user;
};

/** A customer's own meters, with the area/feeder they hang off. */
const getMyConnections = async (userId: string) => {
  return prisma.connection.findMany({
    where: { customerId: userId, isDeleted: false },
    select: {
      id: true,
      meterNo: true,
      connectionType: true,
      tariffRate: true,
      status: true,
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
                select: {
                  id: true,
                  name: true,
                  zone: { select: { id: true, name: true, code: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
};

/**
 * A technician's own availability and specialization. Going unavailable
 * only stops NEW dispatches (the assign check reads isAvailable); jobs
 * already in hand stay assigned.
 */
const updateTechnicianProfile = async (
  userId: string,
  payload: Partial<{ isAvailable: boolean; specialization: string }>,
  ip: string | null
) => {
  const profile = await prisma.technicianProfile.findUnique({
    where: { userId },
    select: { id: true, isAvailable: true, specialization: true },
  });

  if (!profile) throw new AppError(404, 'No technician profile exists for this account');

  await prisma.$transaction(async (tx) => {
    await tx.technicianProfile.update({ where: { userId }, data: payload });

    await writeAudit(tx, {
      actorId: userId,
      action: 'TECHNICIAN_PROFILE_UPDATED',
      entityType: 'User',
      entityId: userId,
      before: { isAvailable: profile.isAvailable, specialization: profile.specialization },
      after: payload,
      ipAddress: ip,
    });
  });

  return getMe(userId);
};

export const UserService = {
  getMe,
  updateMe,
  updateAvatar,
  getMyConnections,
  updateTechnicianProfile,
};
