import { Request } from 'express';
import AppError from '../errors/AppError';

/**
 * Express 5 types route params as `string | string[]` because a pattern can
 * repeat a name. Every route here declares each param once, so this narrows
 * to a plain string in one place instead of casting in every controller.
 */
export const param = (req: Request, name: string): string => {
  const value = req.params[name];

  if (typeof value !== 'string' || !value) {
    throw new AppError(400, `Missing or invalid route parameter: ${name}`);
  }

  return value;
};

/** The authenticated user, or a 401 if the route was left unguarded. */
export const currentUser = (req: Request) => {
  if (!req.user) throw new AppError(401, 'Authentication required');
  return req.user;
};
