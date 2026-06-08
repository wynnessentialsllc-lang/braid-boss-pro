// Lightweight, dependency-free, best-effort rate limiter for public API
// routes (fixed window, in-process Map).
//
// IMPORTANT: this is a speed bump, not a guarantee. On serverless the
// counter lives in a single instance's memory, so it resets on cold
// starts and isn't shared across concurrent instances. It meaningfully
// raises the cost of a naive scripted flood (cost-abuse on the AI
// endpoint, storage/analytics spam) with zero new infrastructure. For a
// hard guarantee, back this with a shared store (Supabase/Upstash) later.

type Bucket = { count: number; resetAt: number };

// Per-name window stores so different routes don't collide on a key.
const stores = new Map<string, Map<string, Bucket>>();

const storeFor = (name: string): Map<string, Bucket> => {
  let s = stores.get(name);
  if (!s) {
    s = new Map();
    stores.set(name, s);
  }
  return s;
};

// Cheap eviction so the Map can't grow without bound under a key-spray
// attack: when it gets large, drop everything already past its window.
const sweep = (store: Map<string, Bucket>, now: number) => {
  if (store.size < 5000) return;
  for (const [k, b] of store) {
    if (b.resetAt <= now) store.delete(k);
  }
};

/**
 * Returns { ok } when the key is under `limit` requests in the current
 * `windowMs` window, otherwise { ok: false, retryAfter } in seconds.
 */
export const rateLimit = (
  name: string,
  key: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfter: number } => {
  const now = Date.now();
  const store = storeFor(name);
  sweep(store, now);
  const bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;
  return { ok: true };
};

/** Best-effort client IP from common proxy headers. Falls back to a
 *  shared bucket ("unknown") when no header is present — which simply
 *  means anonymous callers share one window, still a useful cap. */
export const clientIp = (req: Request): string => {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
};
