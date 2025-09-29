// src/utils/dedup.ts
export interface DedupEnv {
  LIKES_KV: KVNamespace;
}

/**
 * Перевіряє, чи бачили ми вже цей update_id нещодавно.
 * Якщо так — true. Якщо ні — ставить маркер у KV на TTL і повертає false.
 * TTL клемпиться: [60s .. 7 діб] аби уникати падінь воркера.
 */
export async function seenUpdateRecently(
  env: DedupEnv,
  updateId: number,
  ttlSec = 120
): Promise<boolean> {
  // Нормалізація TTL
  const ttlUsed = Math.max(60, Math.min(7 * 24 * 3600, Math.floor(ttlSec)));

  const key = `dedup:update:${updateId}`;
  const existed = await env.LIKES_KV.get(key);
  if (existed) return true;

  // Ставитимемо маркер з TTL (клемплений)
  await env.LIKES_KV.put(key, "1", { expirationTtl: ttlUsed });
  return false;
}