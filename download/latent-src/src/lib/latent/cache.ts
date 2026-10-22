// Latent.pk — Shared cache utility
// Production: REDIS_URL env var → real Redis (multi-instance safe)
// Dev fallback: in-memory Map (single-instance only)
//
// Usage:
//   import { cacheGet, cacheSet, cacheDelete } from "@/lib/latent/cache";
//
//   const cached = await cacheGet("llm:ENGRO");
//   if (cached) return JSON.parse(cached);
//   const result = await callLlm();
//   await cacheSet("llm:ENGRO", JSON.stringify(result), 3600);  // 1 hour TTL
//
// To enable Redis in production: set REDIS_URL=redis://... env var.

import Redis from "ioredis";
import RedisMock from "ioredis-mock";

let client: Redis | RedisMock | null = null;
let useMock = false;

function getClient(): Redis | RedisMock | null {
  if (client) return client;

  const redisUrl = process.env.REDIS_URL;
  try {
    if (redisUrl) {
      client = new Redis(redisUrl, {
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
        lazyConnect: false,
        retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
      });
      client.on("error", (err) => {
        console.warn("[cache] Redis error (will use in-memory fallback):", err.message);
      });
      console.info(`[cache] Connected to Redis at ${redisUrl.replace(/:[^@]+@/, ":***@")}`);
    } else {
      // No REDIS_URL set — use in-memory mock
      client = new RedisMock();
      useMock = true;
      console.info("[cache] Using in-memory cache (set REDIS_URL env var for production Redis)");
    }
  } catch (err) {
    console.warn("[cache] Failed to init Redis, falling back to in-memory:", err);
    client = new RedisMock();
    useMock = true;
  }
  return client;
}

export async function cacheGet(key: string): Promise<string | null> {
  try {
    const c = getClient();
    if (!c) return null;
    return await c.get(key);
  } catch (err) {
    console.warn(`[cache] GET ${key} failed:`, err);
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number = 3600): Promise<void> {
  try {
    const c = getClient();
    if (!c) return;
    await c.set(key, value, "EX", ttlSeconds);
  } catch (err) {
    console.warn(`[cache] SET ${key} failed:`, err);
  }
}

export async function cacheDelete(key: string): Promise<void> {
  try {
    const c = getClient();
    if (!c) return;
    await c.del(key);
  } catch (err) {
    console.warn(`[cache] DEL ${key} failed:`, err);
  }
}

export async function cacheGetJSON<T>(key: string): Promise<T | null> {
  const raw = await cacheGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSetJSON<T>(key: string, value: T, ttlSeconds: number = 3600): Promise<void> {
  await cacheSet(key, JSON.stringify(value), ttlSeconds);
}

export function isUsingMock(): boolean {
  return useMock;
}

export function getCacheStatus(): { type: "redis" | "memory"; ready: boolean } {
  return { type: useMock ? "memory" : "redis", ready: !!client };
}
