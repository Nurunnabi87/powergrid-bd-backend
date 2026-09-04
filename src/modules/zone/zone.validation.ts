import { z } from 'zod';

const createZoneSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Zone name must be at least 2 characters'),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{2,20}$/, 'Code must be 2-20 uppercase letters, digits or dashes'),
    city: z.string().trim().min(2, 'City is required'),
    district: z.string().trim().max(100).optional(),
  }),
});

const updateZoneSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(2).optional(),
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9-]{2,20}$/)
        .optional(),
      city: z.string().trim().min(2).optional(),
      district: z.string().trim().max(100).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'Provide at least one field to update',
    }),
});

const idParamSchema = z.object({
  params: z.object({
    id: z.uuid('Invalid zone id'),
  }),
});

export const ZoneValidation = {
  createZoneSchema,
  updateZoneSchema,
  idParamSchema,
};
