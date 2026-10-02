import { z } from 'zod';

const initiateSchema = z.object({
  body: z.object({
    billId: z.uuid('billId must be a valid uuid'),
    // Optional for backward compatibility: existing clients keep getting bKash.
    provider: z
      .enum(['BKASH', 'STRIPE'], { error: 'provider must be BKASH or STRIPE' })
      .optional(),
  }),
});

const idParamSchema = z.object({
  params: z.object({ id: z.uuid('Invalid payment id') }),
});

export const PaymentValidation = { initiateSchema, idParamSchema };
