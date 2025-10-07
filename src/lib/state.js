// Простий стан діалогу в KV: state:<chatId>
// Використовується для "очікуємо URL" та "очікуємо рядок для чекліста" тощо.

const key = (chatId) => `state:${chatId}`;

export async function getState(env, chatId) {
  try {
    const raw = await env.STATE_KV.get(key(chatId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function setState(env, chatId, patch, ttlSec = 3600) {
  const cur = await getState(env, chatId);
  const next = { ...cur, ...patch, _ts: Date.now() };
  try {
    await env.STATE_KV.put(key(chatId), JSON.stringify(next), { expirationTtl: ttlSec });
  } catch (_) {}
  return next;
}

export async function clearState(env, chatId) {
  try {
    await env.STATE_KV.delete(key(chatId));
  } catch (_) {}
}