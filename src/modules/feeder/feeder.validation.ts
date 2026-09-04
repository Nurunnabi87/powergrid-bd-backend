import { z } from 'zod';

const codeRule = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{2,20}$/, 'Code must be 2-20 uppercase letters, digits or dashes');

const createFeederSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Feeder name must be at least 2 characters'),
    code: codeRule,
    substationId: z.uuid('substationId must be a valid uuid'),
    voltageLevel: z
      .string()
      .trim()
      .regex(/^\d{1,3}kV$/i, 'Voltage level must look like "11kV" or "33kV"'),
    loadKw: z.number().positive('Load must be greater than zero'),
  }),
});

const updateFeederSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(2).optional(),
      code: codeRule.optional(),
      substationId: z.uuid().optional(),
      voltageLevel: z
        .string()
        .trim()
        .regex(/^\d{1,3}kV$/i)
        .optional(),
      loadKw: z.number().positive().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'Provide at least one field to update',
    }),
});

const idParamSchema = z.object({
  params: z.object({ id: z.uuid('Invalid feeder id') }),
});

export const FeederValidation = {
  createFeederSchema,
  updateFeederSchema,
  idParamSchema,
};
