// src/routes/dedupTest.ts
import { seenUpdateRecently } from "../utils/dedup";

export type DedupTestEnv = {
  LIKES_KV: KVNamespace;
};

/**
 * Тестуємо механізм антидублів без Телеграма:
 * - Раз викликаємо seenUpdateRecently(id) → очікуємо false (ще не бачили)
 * - Одразу вдруге → очікуємо true (щойно позначили)
 */
export async function handleDedupTest(
  env: DedupTestEnv,
  id: string,
  ttlSec: number = 120
): Promise<Response> {
  const first = await seenUpdateRecently(env, Number(id), ttlSec);
  const second = await seenUpdateRecently(env, Number(id), ttlSec);

  const body = JSON.stringify({ id: Number(id), ttlSec, first, second });
  return new Response(body, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}