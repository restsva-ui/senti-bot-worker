// src/routes/dedupTest.ts
import { seenUpdateRecently } from "../utils/dedup";

export type DedupTestEnv = {
  LIKES_KV: KVNamespace;
};

/**
 * Тестуємо механізм антидублів без Телеграма.
 * Повертаємо як запитуваний TTL, так і фактично використаний (з урахуванням клемпу в утиліті).
 */
export async function handleDedupTest(
  env: DedupTestEnv,
  id: string,
  ttlRequested: number = 120
): Promise<Response> {
  try {
    const numId = Number(id);
    if (!Number.isFinite(numId)) {
      return new Response(
        JSON.stringify({ error: "id must be a number", id }),
        { status: 400, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }

    // Перший виклик — має бути false, другий — true
    const first = await seenUpdateRecently(env, numId, ttlRequested);
    const second = await seenUpdateRecently(env, numId, ttlRequested);

    // Утиліта клемпить TTL: повторно порахуємо, що саме використається
    const ttlUsed = Math.max(60, Math.min(7 * 24 * 3600, Math.floor(ttlRequested)));

    const body = JSON.stringify({
      id: numId,
      ttlRequested,
      ttlUsed,
      first,
      second,
    });
    return new Response(body, {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (err: any) {
    console.error("dedup test error:", err);
    return new Response(
      JSON.stringify({ error: "internal", message: String(err && err.message || err) }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
}