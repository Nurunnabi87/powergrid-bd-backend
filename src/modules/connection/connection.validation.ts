import { z } from 'zod';

const typeRule = z.enum(['RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL']);
const statusRule = z.enum(['ACTIVE', 'SUSPENDED', 'DISCONNECTED']);

const createConnectionSchema = z.object({
  body: z.object({
    meterNo: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{4,24}$/, 'Meter number must be 4-24 letters, digits or dashes'),
    customerId: z.uuid('customerId must be a valid uuid'),
    areaId: z.uuid('areaId must be a valid uuid'),
    connectionType: typeRule.optional(),
    tariffRate: z
      .number()
      .positive('Tariff rate must be greater than zero')
      .max(100, 'Tariff rate looks unrealistic')
      .optional(),
  }),
});

const updateConnectionSchema = z.object({
  body: z
    .object({
      meterNo: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9-]{4,24}$/)
        .optional(),
      areaId: z.uuid().optional(),
      connectionType: typeRule.optional(),
      tariffRate: z.number().positive().max(100).optional(),
      status: statusRule.optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'Provide at least one field to update',
    }),
});

const idParamSchema = z.object({
  params: z.object({ id: z.uuid('Invalid connection id') }),
});

export const ConnectionValidation = {
  createConnectionSchema,
  updateConnectionSchema,
  idParamSchema,
};
