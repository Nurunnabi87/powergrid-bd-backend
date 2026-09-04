import { z } from 'zod';

const initiateSchema = z.object({
  body: z.object({
    billId: z.uuid('billId must be a valid uuid'),
  }),
});

const idParamSchema = z.object({
  params: z.object({ id: z.uuid('Invalid payment id') }),
});

export const PaymentValidation = { initiateSchema, idParamSchema };
