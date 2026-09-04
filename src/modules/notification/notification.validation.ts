import { z } from 'zod';

const idParamSchema = z.object({
  params: z.object({ id: z.uuid('Invalid notification id') }),
});

export const NotificationValidation = { idParamSchema };
