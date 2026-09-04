import { z } from 'zod';

const codeRule = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{2,20}$/, 'Code must be 2-20 uppercase letters, digits or dashes');

const createSubstationSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Substation name must be at least 2 characters'),
    code: codeRule,
    zoneId: z.uuid('zoneId must be a valid uuid'),
    capacityMva: z.number().positive('Capacity must be greater than zero'),
    status: z.enum(['OPERATIONAL', 'MAINTENANCE', 'OFFLINE']).optional(),
  }),
});

const updateSubstationSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(2).optional(),
      code: codeRule.optional(),
      zoneId: z.uuid().optional(),
      capacityMva: z.number().positive().optional(),
      status: z.enum(['OPERATIONAL', 'MAINTENANCE', 'OFFLINE']).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'Provide at least one field to update',
    }),
});

const idParamSchema = z.object({
  params: z.object({ id: z.uuid('Invalid substation id') }),
});

export const SubstationValidation = {
  createSubstationSchema,
  updateSubstationSchema,
  idParamSchema,
};
