import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import config from '../../config';
import AppError from '../../errors/AppError';
import { UserRole, UserStatus } from '../../generated/prisma/enums';
import { createToken, verifyToken, TTokenPayload } from '../../shared/jwt';
import prisma from '../../shared/prisma';
import { writeAuditSafe } from '../../shared/auditLog';

const googleClient = new OAuth2Client(config.google_client_id);

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  phone: true,
  avatarUrl: true,
} as const;

type TPublicUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  phone: string | null;
  avatarUrl: string | null;
};

type TAuthResult = {
  user: TPublicUser;
  accessToken: string;
  refreshToken: string;
};

/** Refresh tokens are stored as SHA-256 digests, never in plain text. */
const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const issueTokens = async (user: {
  id: string;
  email: string;
  role: UserRole;
}): Promise<{ accessToken: string; refreshToken: string }> => {
  const payload: TTokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  const accessToken = createToken(
    payload,
    config.jwt_access_secret,
    config.jwt_access_expires_in
  );
  const refreshToken = createToken(
    payload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in
  );

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(refreshToken),
      userId: user.id,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });

  return { accessToken, refreshToken };
};

// ---------- REGISTER ----------

const register = async (payload: {
  name: string;
  email: string;
  password: string;
  phone?: string;
  address?: string;
}): Promise<TAuthResult> => {
  const existing = await prisma.user.findUnique({
    where: { email: payload.email },
    select: { id: true },
  });

  if (existing) {
    throw new AppError(409, 'An account with this email already exists');
  }

  const hashedPassword = await bcrypt.hash(payload.password, config.bcrypt_salt_rounds);

  // Self-registration always creates a CUSTOMER. Elevating to TECHNICIAN or
  // ADMIN is an admin-only operation, so the role can never be chosen by
  // the caller.
  const user = await prisma.user.create({
    data: {
      name: payload.name,
      email: payload.email,
      password: hashedPassword,
      phone: payload.phone,
      address: payload.address,
      role: UserRole.CUSTOMER,
    },
    select: publicUserSelect,
  });

  const tokens = await issueTokens(user);

  await writeAuditSafe({
    actorId: user.id,
    action: 'USER_REGISTERED',
    entityType: 'User',
    entityId: user.id,
    after: { email: user.email, role: user.role },
  });

  return { user, ...tokens };
};

// ---------- LOGIN ----------

const login = async (payload: {
  email: string;
  password: string;
}): Promise<TAuthResult> => {
  const user = await prisma.user.findUnique({
    where: { email: payload.email },
    select: { ...publicUserSelect, password: true, isDeleted: true },
  });

  // The same message is returned for an unknown email and a wrong password
  // so this endpoint cannot be used to enumerate registered accounts.
  if (!user || user.isDeleted) {
    throw new AppError(401, 'Invalid email or password');
  }

  if (!user.password) {
    throw new AppError(
      400,
      'This account was created with Google. Please sign in with Google'
    );
  }

  const matches = await bcrypt.compare(payload.password, user.password);
  if (!matches) {
    throw new AppError(401, 'Invalid email or password');
  }

  if (user.status === UserStatus.BANNED) {
    throw new AppError(403, 'Your account has been banned. Contact support');
  }

  const { password: _password, isDeleted: _isDeleted, ...publicUser } = user;
  const tokens = await issueTokens(publicUser);

  return { user: publicUser, ...tokens };
};

// ---------- GOOGLE (GCP) SOCIAL LOGIN ----------

const googleLogin = async (idToken: string): Promise<TAuthResult> => {
  if (!config.google_client_id) {
    throw new AppError(500, 'Google login is not configured on this server');
  }

  let email: string | undefined;
  let name: string | undefined;
  let googleId: string | undefined;
  let picture: string | undefined;

  try {
    // Verifies the signature, issuer and expiry AND that the token was
    // minted for THIS client id. Without the audience check, a valid Google
    // token issued to any other application would be accepted here.
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: config.google_client_id,
    });
    const claims = ticket.getPayload();
    email = claims?.email;
    name = claims?.name;
    googleId = claims?.sub;
    picture = claims?.picture;
  } catch {
    throw new AppError(401, 'Invalid or expired Google ID token');
  }

  if (!email || !googleId) {
    throw new AppError(401, 'Google account did not provide an email address');
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { ...publicUserSelect, isDeleted: true, googleId: true },
  });

  if (existing?.isDeleted) {
    throw new AppError(401, 'This account has been removed');
  }

  if (existing && existing.status === UserStatus.BANNED) {
    throw new AppError(403, 'Your account has been banned. Contact support');
  }

  // Link the Google identity onto an existing password account rather than
  // creating a second user row for the same email address.
  const user = existing
    ? await prisma.user.update({
        where: { email },
        data: {
          googleId: existing.googleId ?? googleId,
          avatarUrl: existing.avatarUrl ?? picture,
        },
        select: publicUserSelect,
      })
    : await prisma.user.create({
        data: {
          name: name ?? email.split('@')[0],
          email,
          googleId,
          avatarUrl: picture,
          role: UserRole.CUSTOMER,
        },
        select: publicUserSelect,
      });

  const tokens = await issueTokens(user);

  if (!existing) {
    await writeAuditSafe({
      actorId: user.id,
      action: 'USER_REGISTERED_VIA_GOOGLE',
      entityType: 'User',
      entityId: user.id,
      after: { email: user.email },
    });
  }

  return { user, ...tokens };
};

// ---------- REFRESH ----------

const refreshToken = async (token: string): Promise<{ accessToken: string }> => {
  const payload = verifyToken(token, config.jwt_refresh_secret);

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, revokedAt: true, expiresAt: true },
  });

  // A valid signature alone is not enough: the token must still be an
  // active row, which is what makes logout actually revoke a session.
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new AppError(401, 'Refresh token is invalid or has been revoked');
  }

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

  const accessToken = createToken(
    { userId: user.id, email: user.email, role: user.role },
    config.jwt_access_secret,
    config.jwt_access_expires_in
  );

  return { accessToken };
};

// ---------- LOGOUT ----------

const logout = async (token: string): Promise<{ revoked: boolean }> => {
  const result = await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return { revoked: result.count > 0 };
};

// ---------- CHANGE PASSWORD ----------

const changePassword = async (
  userId: string,
  payload: { oldPassword: string; newPassword: string }
): Promise<{ changed: boolean }> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, password: true },
  });

  if (!user?.password) {
    throw new AppError(
      400,
      'This account has no password set. Sign in with Google instead'
    );
  }

  const matches = await bcrypt.compare(payload.oldPassword, user.password);
  if (!matches) {
    throw new AppError(401, 'Current password is incorrect');
  }

  const hashedPassword = await bcrypt.hash(
    payload.newPassword,
    config.bcrypt_salt_rounds
  );

  // Changing the password revokes every outstanding refresh token, so a
  // session stolen before the reset cannot survive it.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await writeAuditSafe({
    actorId: userId,
    action: 'PASSWORD_CHANGED',
    entityType: 'User',
    entityId: userId,
  });

  return { changed: true };
};

export const AuthService = {
  register,
  login,
  googleLogin,
  refreshToken,
  logout,
  changePassword,
};
