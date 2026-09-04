import { z } from 'zod';

const severityRule = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

const reportOutageSchema = z.object({
  body: z.object({
    areaId: z.uuid('areaId must be a valid uuid'),
    title: z.string().trim().min(5, 'Title must be at least 5 characters').max(150),
    description: z
      .string()
      .trim()
      .min(10, 'Please describe the problem in at least 10 characters')
      .max(1000),
    severity: severityRule.optional(),
  }),
});

const assignSchema = z.object({
  body: z.object({
    technicianId: z.uuid('technicianId must be a valid uuid'),
    notes: z.string().trim().max(500).optional(),
  }),
});

const updateStatusSchema = z.object({
  body: z.object({
    status: z.enum([
      'ACKNOWLEDGED',
      'ASSIGNED',
      'IN_PROGRESS',
      'RESOLVED',
      'CLOSED',
      'CANCELLED',
    ]),
    note: z.string().trim().max(500).optional(),
  }),
});

const restoreSchema = z.object({
  body: z.object({
    note: z.string().trim().max(500).optional(),
  }),
});

const idParamSchema = z.object({
  params: z.object({ id: z.uuid('Invalid outage id') }),
});

export const OutageValidation = {
  reportOutageSchema,
  assignSchema,
  updateStatusSchema,
  restoreSchema,
  idParamSchema,
};
