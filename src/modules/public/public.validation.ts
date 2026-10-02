import { z } from 'zod';

const scheduleQuerySchema = z.object({
  query: z.object({
    zoneId: z.uuid('Invalid zone id').optional(),
    date: z.iso.date('date must be YYYY-MM-DD').optional(),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
});

const contactSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
    email: z.email('Invalid email address').toLowerCase(),
    phone: z
      .string()
      .regex(/^01[3-9]\d{8}$/, 'Phone must be a valid BD number, e.g. 01712345678')
      .optional(),
    subject: z
      .string()
      .trim()
      .min(3, 'Subject must be at least 3 characters')
      .max(150, 'Subject must be at most 150 characters'),
    message: z
      .string()
      .trim()
      .min(10, 'Message must be at least 10 characters')
      .max(2000, 'Message must be at most 2000 characters'),
  }),
});

export const PublicValidation = { scheduleQuerySchema, contactSchema };
