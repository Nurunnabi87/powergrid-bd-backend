import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { UserRole } from '../generated/prisma/enums';

export type TTokenPayload = {
  userId: string;
  email: string;
  role: UserRole;
};

export const createToken = (
  payload: TTokenPayload,
  secret: string,
  expiresIn: string
): string =>
  jwt.sign(payload, secret, {
    expiresIn: expiresIn as SignOptions['expiresIn'],
  });

export const verifyToken = (token: string, secret: string): TTokenPayload => {
  const decoded = jwt.verify(token, secret) as JwtPayload & TTokenPayload;
  return {
    userId: decoded.userId,
    email: decoded.email,
    role: decoded.role,
  };
};
