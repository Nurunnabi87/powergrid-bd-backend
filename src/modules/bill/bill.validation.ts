import { z } from 'zod';

const generateBillsSchema = z.object({
  body: z.object({
    billingPeriod: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'billingPeriod must be YYYY-MM, e.g. 2026-09'),
    dueDate: z.iso.date('dueDate must be YYYY-MM-DD'),
    areaId: z.uuid().optional(),
    defaultUnits: z.number().positive().max(100000).optional(),
  }),
});

const idParamSchema = z.object({
  params: z.object({ id: z.uuid('Invalid bill id') }),
});

export const BillValidation = { generateBillsSchema, idParamSchema };
