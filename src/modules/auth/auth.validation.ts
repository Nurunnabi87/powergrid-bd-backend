import { z } from 'zod';

const passwordRules = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const registerSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters'),
    email: z.email('Invalid email address').toLowerCase(),
    password: passwordRules,
    phone: z
      .string()
      .regex(/^01[3-9]\d{8}$/, 'Phone must be a valid BD number, e.g. 01712345678')
      .optional(),
    address: z.string().trim().max(255).optional(),
  }),
});

const loginSchema = z.object({
  body: z.object({
    email: z.email('Invalid email address').toLowerCase(),
    password: z.string().min(1, 'Password is required'),
  }),
});

const googleLoginSchema = z.object({
  body: z.object({
    idToken: z.string().min(10, 'A Google ID token is required'),
  }),
});

const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(10, 'A refresh token is required'),
  }),
});

const changePasswordSchema = z.object({
  body: z.object({
    oldPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordRules,
  }),
});

export const AuthValidation = {
  registerSchema,
  loginSchema,
  googleLoginSchema,
  refreshTokenSchema,
  changePasswordSchema,
};
