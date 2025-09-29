// src/utils/dedup.ts
export interface DedupEnv {
  LIKES_KV: KVNamespace;
}

/**
 * Перевіряє, чи бачили ми вже цей update_id нещодавно.
 * Якщо так — повертає true. Якщо ні — ставить маркер у KV на TTL і повертає false.
 */
export async function seenUpdateRecently(
  env: DedupEnv,
  updateId: number,
  ttlSec = 120
): Promise<boolean> {
  const key = `dedup:update:${updateId}`;
  const existed = await env.LIKES_KV.get(key);
  if (existed) return true;
  await env.LIKES_KV.put(key, "1", { expirationTtl: ttlSec });
  return false;
}