import Redis from 'ioredis';
import config from '../config';

/**
 * Redis is optional. When REDIS_URL is unset the app runs with caching
 * disabled rather than failing to boot, and every cache helper below
 * degrades to a straight database read.
 */
const redis: Redis | null = config.redis_url
  ? new Redis(config.redis_url, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      // Never let a Redis outage take request handling down with it.
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
    })
  : null;

if (redis) {
  redis.on('error', (err) => {
    console.error('[redis] connection error:', err.message);
  });
}

export const isCacheEnabled = (): boolean => redis !== null;

export const cacheGet = async <T>(key: string): Promise<T | null> => {
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // A cache miss and a cache failure are handled identically: fall
    // through to Postgres.
    return null;
  }
};

export const cacheSet = async (
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> => {
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    /* caching is best-effort */
  }
};

/** Deletes every key matching a glob pattern, e.g. `schedule:area:*`. */
export const cacheInvalidate = async (pattern: string): Promise<void> => {
  if (!redis) return;
  try {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  } catch {
    /* best-effort */
  }
};

export default redis;
