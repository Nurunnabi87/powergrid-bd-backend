import { z } from 'zod';

const codeRule = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{2,20}$/, 'Code must be 2-20 uppercase letters, digits or dashes');

const tierRule = z.enum(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']);

const createAreaSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Area name must be at least 2 characters'),
    code: codeRule,
    feederId: z.uuid('feederId must be a valid uuid'),
    population: z.number().int().nonnegative().optional(),
    priorityTier: tierRule.optional(),
  }),
});

const updateAreaSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(2).optional(),
      code: codeRule.optional(),
      feederId: z.uuid().optional(),
      population: z.number().int().nonnegative().optional(),
      priorityTier: tierRule.optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'Provide at least one field to update',
    }),
});

const idParamSchema = z.object({
  params: z.object({ id: z.uuid('Invalid area id') }),
});

export const AreaValidation = { createAreaSchema, updateAreaSchema, idParamSchema };
