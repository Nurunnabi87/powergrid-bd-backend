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

/** Broad protection for the whole API. */
export const globalLimiter = rateLimit({
  ...shared('ratelimit:global:'),
  windowMs: 15 * 60 * 1000,
  limit: 300,
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
  keyGenerator: (req: Request) => {
    const email = (req.body as { email?: string } | undefined)?.email ?? '';
    return `${ipKeyGenerator(req.ip ?? '')}:${email.toLowerCase()}`;
  },
});

/** Payment initiation is expensive and hits a third party - keep it low. */
export const paymentLimiter = rateLimit({
  ...shared('ratelimit:payment:'),
  windowMs: 60 * 1000,
  limit: 10,
});
