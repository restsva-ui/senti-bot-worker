import { kvGetJSON, kvPutJSON } from "./kv.js";

/**
 * Пам'ять користувача у LIKES_KV (senti-state)
 * Формат ключа: u:<chatId>:mem
 * Зберігаємо останні N реплік (role: "user"|"bot", text, ts)
 */
const MAX_MESSAGES = 20;
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 днів

function keyFor(chatId) {
  return `u:${chatId}:mem`;
}

export async function rememberUserMessage(env, chatId, text) {
  if (!env.LIKES_KV) return;
  const key = keyFor(chatId);
  const state = (await kvGetJSON(env.LIKES_KV, key, { messages: [] })) || { messages: [] };
  state.messages.push({ role: "user", text: String(text || ""), ts: Date.now() });
  // тримаємо максимум останніх
  if (state.messages.length > MAX_MESSAGES) {
    state.messages = state.messages.slice(-MAX_MESSAGES);
  }
  await kvPutJSON(env.LIKES_KV, key, state, TTL_SECONDS);
  return state;
}

export async function rememberBotMessage(env, chatId, text) {
  if (!env.LIKES_KV) return;
  const key = keyFor(chatId);
  const state = (await kvGetJSON(env.LIKES_KV, key, { messages: [] })) || { messages: [] };
  state.messages.push({ role: "bot", text: String(text || ""), ts: Date.now() });
  if (state.messages.length > MAX_MESSAGES) {
    state.messages = state.messages.slice(-MAX_MESSAGES);
  }
  await kvPutJSON(env.LIKES_KV, key, state, TTL_SECONDS);
  return state;
}

export async function getShortContext(env, chatId, limit = 6) {
  if (!env.LIKES_KV) return [];
  const key = keyFor(chatId);
  const state = await kvGetJSON(env.LIKES_KV, key, { messages: [] });
  const msgs = state?.messages || [];
  return msgs.slice(-Math.max(0, limit));
}

export async function resetMemory(env, chatId) {
  if (!env.LIKES_KV || !chatId) return;
  const key = keyFor(chatId);
  await kvPutJSON(env.LIKES_KV, key, { messages: [] }, TTL_SECONDS);
}