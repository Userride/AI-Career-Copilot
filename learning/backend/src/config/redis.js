import Redis from 'ioredis';
import { config } from './index.js';

let redis = null;
let memoryCache = new Map();

export function getRedis() {
  if (redis) return redis;
  try {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    redis.on('error', () => {});
  } catch {
    redis = null;
  }
  return redis;
}

export async function cacheGet(key) {
  const client = getRedis();
  if (client) {
    try {
      await client.connect?.().catch(() => {});
      const val = await client.get(key);
      if (val) return JSON.parse(val);
    } catch {
      /* fallback */
    }
  }
  const entry = memoryCache.get(key);
  if (entry && entry.expires > Date.now()) return entry.value;
  return null;
}

export async function cacheSet(key, value, ttlSeconds = 3600) {
  const client = getRedis();
  if (client) {
    try {
      await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      return;
    } catch {
      /* fallback */
    }
  }
  memoryCache.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}
