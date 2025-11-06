/**
 * Простий rate-limit: фіксоване вікно.
 * windowMs = 2000 мс, burst = 3 (за замовч.)
 * Використовує SENTI_CACHE.
 */
export async function rateLimit(env, chatId, opts = {}) {
  const windowMs = opts.windowMs ?? 2000;
  const burst = opts.burst ?? 3;
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const key = `rl:${chatId}:${bucket}`;

  if (!env.SENTI_CACHE) {
    return { allowed: true, retryAfterMs: 0 }; // без кеша не блокуємо
  }

  const current = parseInt((await env.SENTI_CACHE.get(key)) || "0", 10);
  if (current >= burst) {
    const retryAfterMs = windowMs - (now % windowMs);
    return { allowed: false, retryAfterMs };
  }

  await env.SENTI_CACHE.put(key, String(current + 1), { expirationTtl: Math.ceil(windowMs / 1000) + 1 });

  return { allowed: true, retryAfterMs: 0 };
}

/** Щоб не спамити попередженням — показуємо його не частіше, ніж раз на warnTtlSec. */
export async function allowWarn(env, chatId, warnTtlSec = 10) {
  if (!env.SENTI_CACHE) return true;
  const key = `rlwarn:${chatId}`;
  const was = await env.SENTI_CACHE.get(key);
  if (was) return false;
  await env.SENTI_CACHE.put(key, "1", { expirationTtl: warnTtlSec });
  return true;
}