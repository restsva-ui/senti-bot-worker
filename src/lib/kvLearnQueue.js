// src/lib/kvLearnQueue.js

/** Кладе задачу у KV LEARN_QUEUE_KV під ключ learn:<user>:<ts> */
export async function enqueueLearn(env, userId, payload) {
  if (!env?.LEARN_QUEUE_KV) {
    console.warn("LEARN_QUEUE_KV binding is missing, skipping enqueue");
    return { ok: false, reason: "no_kv" };
  }
  const key = `learn:${userId}:${Date.now()}`;
  const val = JSON.stringify({
    at: new Date().toISOString(),
    userId,
    payload,
  });
  await env.LEARN_QUEUE_KV.put(key, val, { expirationTtl: 60 * 60 * 24 * 7 }); // 7 днів
  return { ok: true, key };
}
