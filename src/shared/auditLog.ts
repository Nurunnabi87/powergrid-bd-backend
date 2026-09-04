import { Request } from 'express';
import { Prisma } from '../generated/prisma/client';
import prisma from './prisma';

/**
 * Minimal surface shared by PrismaClient and the transaction client, so an
 * audit entry can be written inside the same transaction as the change it
 * describes (and rolled back with it if the transaction fails).
 */
type TPrismaLike = Prisma.TransactionClient | typeof prisma;

export type TAuditInput = {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
};

export const writeAudit = async (
  client: TPrismaLike,
  input: TAuditInput
): Promise<void> => {
  await client.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: (input.before ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      after: (input.after ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      ipAddress: input.ipAddress ?? null,
    },
  });
};

/** Best-effort audit outside a transaction - never fails the request. */
export const writeAuditSafe = async (input: TAuditInput): Promise<void> => {
  try {
    await writeAudit(prisma, input);
  } catch (error) {
    console.error('[audit] failed to write entry:', error);
  }
};

export const clientIp = (req: Request): string | null =>
  req.ip ?? req.socket.remoteAddress ?? null;
