import crypto from 'crypto';
import { Request } from 'express';
import rateLimit, { ipKeyGenerator, Options } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import redis from '../shared/redis';

/**
 * On Vercel every serverless instance keeps its own in-memory counters, so
 * the limit is only truly global when Redis is configured. The Redis store
 * is used whenever REDIS_URL is set and falls back to memory otherwise.
 */
const client = redis;

/**
 * Each limiter needs its OWN store instance - express-rate-limit refuses to
 * boot with ERR_ERL_STORE_REUSE if one store object is shared, because the
 * store holds per-limiter window state.
 */
const makeStore = (prefix: string) =>
  client
    ? new RedisStore({
        sendCommand: (command: string, ...args: string[]) =>
          client.call(command, ...args) as Promise<never>,
        prefix,
      })
    : undefined;

const shared = (prefix: string): Partial<Options> => {
  const store = makeStore(prefix);

  return {
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(store && { store }),
    handler: (_req, res, _next, options) => {
      res.status(options.statusCode).json({
        success: false,
        message: 'Too many requests. Please slow down and try again later',
        errors: [],
        errorDetails: [],
      });
    },
  };
};

const digest = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);

const ipKey = (req: Request): string => `ip:${ipKeyGenerator(req.ip ?? '')}`;

/**
 * Broad protection for the whole API.
 *
 * Authenticated requests are budgeted per token rather than per IP. A
 * server-rendered frontend (Next.js) sends every user's request from the
 * same few server addresses, so an IP key would let one busy page throttle
 * every signed-in user at once. The token is hashed so raw credentials never
 * reach the rate-limit store; anonymous traffic still falls back to the IP.
 */
const tokenOrIpKey = (req: Request): string => {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? `token:${digest(header.slice(7))}` : ipKey(req);
};

export const globalLimiter = rateLimit({
  ...shared('ratelimit:global:'),
  windowMs: 15 * 60 * 1000,
  limit: 300,
  keyGenerator: tokenOrIpKey,
});

/**
 * Credential endpoints get a much tighter budget, keyed by email + IP so a
 * shared NAT address cannot lock every user out of logging in.
 */
export const authLimiter = rateLimit({
  ...shared('ratelimit:auth:'),
  windowMs: 15 * 60 * 1000,
  limit: 10,
  // ipKeyGenerator normalises IPv6 addresses down to their subnet prefix;
  // keying on a raw req.ip would let one client rotate through its own
  // /64 block and get a fresh budget for every address.
  // /refresh-token carries no email, so it is keyed by the refresh token
  // itself; otherwise every user behind one server IP would share a single
  // budget of 10 refreshes.
  keyGenerator: (req: Request) => {
    const body = req.body as { email?: string; refreshToken?: string } | undefined;
    if (!body?.email && typeof body?.refreshToken === 'string') {
      return `refresh:${digest(body.refreshToken)}`;
    }
    const email = body?.email ?? '';
    return `${ipKeyGenerator(req.ip ?? '')}:${email.toLowerCase()}`;
  },
});

/** The public contact form is unauthenticated, so it is tightly capped. */
export const contactLimiter = rateLimit({
  ...shared('ratelimit:contact:'),
  windowMs: 60 * 60 * 1000,
  limit: 5,
});

/** Payment initiation is expensive and hits a third party - keep it low. */
export const paymentLimiter = rateLimit({
  ...shared('ratelimit:payment:'),
  windowMs: 60 * 1000,
  limit: 10,
  // Every payment route is authenticated, so this is a per-user budget.
  keyGenerator: tokenOrIpKey,
});
