import { z } from 'zod';

const isoDate = z.iso.datetime({ message: 'Must be an ISO 8601 date-time string' });

const createScheduleSchema = z.object({
  body: z.object({
    feederId: z.uuid('feederId must be a valid uuid'),
    date: z.iso.date('date must be YYYY-MM-DD'),
    startTime: isoDate,
    endTime: isoDate,
    reason: z.string().trim().max(255).optional(),
  }),
});

const generateScheduleSchema = z.object({
  body: z.object({
    zoneId: z.uuid('zoneId must be a valid uuid'),
    date: z.iso.date('date must be YYYY-MM-DD'),
    totalDeficitMw: z
      .number()
      .positive('Deficit must be greater than zero')
      .max(10000, 'Deficit looks unrealistic'),
    slotHours: z.number().int().min(1).max(12).optional(),
    startHour: z.number().int().min(0).max(23).optional(),
  }),
});

const updateStatusSchema = z.object({
  body: z.object({
    status: z.enum(['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED']),
  }),
});

const idParamSchema = z.object({
  params: z.object({ id: z.uuid('Invalid schedule id') }),
});

export const ScheduleValidation = {
  createScheduleSchema,
  generateScheduleSchema,
  updateStatusSchema,
  idParamSchema,
};
