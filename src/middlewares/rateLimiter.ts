import { Request } from 'express';
import rateLimit, { Options } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import redis from '../shared/redis';

/**
 * On Vercel every serverless instance keeps its own in-memory counters, so
 * the limit is only truly global when Redis is configured. The Redis store
 * is used whenever REDIS_URL is set and falls back to memory otherwise.
 */
const client = redis;
const store = client
  ? new RedisStore({
      sendCommand: (command: string, ...args: string[]) =>
        client.call(command, ...args) as Promise<never>,
      prefix: 'ratelimit:',
    })
  : undefined;

const shared: Partial<Options> = {
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

/** Broad protection for the whole API. */
export const globalLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 300,
});

/**
 * Credential endpoints get a much tighter budget, keyed by email + IP so a
 * shared NAT address cannot lock every user out of logging in.
 */
export const authLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req: Request) => {
    const email = (req.body as { email?: string } | undefined)?.email ?? '';
    return `${req.ip}:${email.toLowerCase()}`;
  },
});

/** Payment initiation is expensive and hits a third party - keep it low. */
export const paymentLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 10,
});
