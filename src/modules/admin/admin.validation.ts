import { z } from 'zod';

const updateRoleSchema = z.object({
  body: z.object({
    role: z.enum(['CUSTOMER', 'TECHNICIAN', 'ADMIN']),
  }),
});

const updateStatusSchema = z.object({
  body: z.object({
    status: z.enum(['ACTIVE', 'BANNED']),
  }),
});

const idParamSchema = z.object({
  params: z.object({ id: z.uuid('Invalid user id') }),
});

const messageIdParamSchema = z.object({
  params: z.object({ id: z.uuid('Invalid message id') }),
});

export const AdminValidation = {
  updateRoleSchema,
  updateStatusSchema,
  idParamSchema,
  messageIdParamSchema,
};
