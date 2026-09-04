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

export const UserValidation = { updateMeSchema };
