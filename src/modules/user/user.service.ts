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

export const UserService = { getMe, updateMe, updateAvatar, getMyConnections };
