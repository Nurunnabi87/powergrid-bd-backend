import { z } from 'zod';

const updateMeSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(2, 'Name must be at least 2 characters').optional(),
      phone: z
        .string()
        .regex(/^01[3-9]\d{8}$/, 'Phone must be a valid BD number, e.g. 01712345678')
        .optional(),
      address: z.string().trim().max(255).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'Provide at least one field to update',
    }),
});

const updateTechnicianProfileSchema = z.object({
  body: z
    .object({
      isAvailable: z.boolean({ error: 'isAvailable must be true or false' }).optional(),
      specialization: z
        .string()
        .trim()
        .min(2, 'Specialization must be at least 2 characters')
        .max(100, 'Specialization must be at most 100 characters')
        .optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'Provide at least one field to update',
    }),
});

export const UserValidation = { updateMeSchema, updateTechnicianProfileSchema };
