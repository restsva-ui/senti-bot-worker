// Upstash Redis (REST) — проста пам'ять на чат
export async function memGet(chatId, env) {
  if (!env.REDIS_URL || !env.REDIS_TOKEN) return null;
  const key = `mem:${chatId}`;
  const r = await fetch(`${env.REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${env.REDIS_TOKEN}` },
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.result || null;
}

export async function memSet(chatId, value, env, ttlSec = 60 * 60 * 24 * 7) {
  if (!env.REDIS_URL || !env.REDIS_TOKEN) return;
  const key = `mem:${chatId}`;
  await fetch(`${env.REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?EX=${ttlSec}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.REDIS_TOKEN}` },
  }).catch(() => {});
}