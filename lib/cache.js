// ================================================================
//  lib/cache.js — In-Memory Cache بسيط (بديل CacheService في GAS)
//  - يعيش مع الـ serverless instance (warm)
//  - يُصفّر عند cold start
// ================================================================

const memCache = new Map();

export function cacheGet(key) {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    memCache.delete(key);
    return null;
  }
  return entry.value;
}

export function cachePut(key, value, ttlSec) {
  memCache.set(key, {
    value,
    expires: Date.now() + ttlSec * 1000
  });
}

export function cacheRemove(key) {
  memCache.delete(key);
}

// تنظيف دوري (كل 5 دقايق)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memCache.entries()) {
    if (entry.expires < now) memCache.delete(key);
  }
}, 5 * 60 * 1000);