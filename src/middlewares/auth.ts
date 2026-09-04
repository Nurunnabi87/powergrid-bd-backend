import { NextFunction, Request, Response } from 'express';
import config from '../config';
import AppError from '../errors/AppError';
import { UserRole, UserStatus } from '../generated/prisma/enums';
import prisma from '../shared/prisma';
import { verifyToken } from '../shared/jwt';

/**
 * Bearer-token guard. `auth()` allows any authenticated user;
 * `auth('ADMIN')` or `auth('ADMIN', 'TECHNICIAN')` restricts by role.
 *
 * The role is re-read from the database on every request rather than
 * trusted from the token, so a demotion or a ban takes effect immediately
 * instead of when the old access token happens to expire.
 */
const auth =
  (...requiredRoles: UserRole[]) =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(
        401,
        'You are not logged in. Provide a Bearer token in the Authorization header'
      );
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token, config.jwt_access_secret);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, role: true, status: true, isDeleted: true },
    });

    if (!user || user.isDeleted) {
      throw new AppError(401, 'The account for this token no longer exists');
    }

    if (user.status === UserStatus.BANNED) {
      throw new AppError(403, 'Your account has been banned. Contact support');
    }

    if (requiredRoles.length > 0 && !requiredRoles.includes(user.role)) {
      throw new AppError(
        403,
        `Access denied. This route requires role: ${requiredRoles.join(' or ')}`
      );
    }

    req.user = { userId: user.id, email: user.email, role: user.role };
    next();
  };

export default auth;
