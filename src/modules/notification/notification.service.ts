import AppError from '../../errors/AppError';
import { NotificationChannel, NotificationType } from '../../generated/prisma/enums';
import { Prisma } from '../../generated/prisma/client';
import { sendEmail } from '../../shared/mailer';
import prisma from '../../shared/prisma';
import { buildMeta, buildQueryOptions } from '../../shared/queryBuilder';

const SORTABLE = ['createdAt', 'isRead'] as const;

type TNotificationSeed = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  outageId?: string | null;
  scheduleId?: string | null;
};

/**
 * Queues in-app notification rows inside an existing transaction, so the
 * notification and the state change it announces commit together.
 */
export const queueNotifications = async (
  tx: Prisma.TransactionClient,
  seeds: TNotificationSeed[]
): Promise<number> => {
  if (seeds.length === 0) return 0;

  const result = await tx.notification.createMany({
    data: seeds.map((seed) => ({
      userId: seed.userId,
      type: seed.type,
      channel: NotificationChannel.IN_APP,
      title: seed.title,
      message: seed.message,
      outageId: seed.outageId ?? null,
      scheduleId: seed.scheduleId ?? null,
    })),
  });

  return result.count;
};

/**
 * Fire-and-forget email delivery, run AFTER the transaction commits so a
 * slow SMTP server never holds a database transaction open.
 */
export const deliverEmails = async (
  messages: { to: string; subject: string; text: string }[]
): Promise<void> => {
  await Promise.all(messages.map((message) => sendEmail(message)));
};

// ---------- CUSTOMER-FACING ENDPOINTS ----------

const getMine = async (userId: string, query: Record<string, unknown>) => {
  const { page, limit, skip, sortBy, sortOrder } = buildQueryOptions({
    query,
    sortableFields: SORTABLE,
  });

  const where = {
    userId,
    ...(query.isRead !== undefined ? { isRead: String(query.isRead) === 'true' } : {}),
    ...(query.type ? { type: query.type as NotificationType } : {}),
  };

  const [data, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        isRead: true,
        readAt: true,
        outageId: true,
        scheduleId: true,
        createdAt: true,
      },
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return { data, meta: buildMeta(page, limit, total), unreadCount };
};

const markRead = async (id: string, userId: string) => {
  // Scoping the update by userId means one customer can never mark another
  // customer's notification as read.
  const result = await prisma.notification.updateMany({
    where: { id, userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });

  if (result.count === 0) {
    const exists = await prisma.notification.findFirst({
      where: { id, userId },
      select: { id: true, isRead: true },
    });

    if (!exists) throw new AppError(404, 'Notification not found');
    return { id, alreadyRead: true };
  }

  return { id, alreadyRead: false };
};

const markAllRead = async (userId: string) => {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });

  return { markedAsRead: result.count };
};

export const NotificationService = { getMine, markRead, markAllRead };
