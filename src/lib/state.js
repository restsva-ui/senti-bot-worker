// Простий state-machine у KV
const KEY = (chatId) => `state:${chatId}`;

export async function getState(env, chatId) {
  try {
    const raw = await env.STATE_KV.get(KEY(chatId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setState(env, chatId, stateObj) {
  try {
    await env.STATE_KV.put(KEY(chatId), JSON.stringify(stateObj), { expirationTtl: 60 * 10 });
  } catch {}
}

export async function clearState(env, chatId) {
  try { await env.STATE_KV.delete(KEY(chatId)); } catch {}
}