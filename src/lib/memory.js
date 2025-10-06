import { kvGetJSON, kvPutJSON } from "./kv.js";

/** Коротка пам'ять у LIKES_KV (senti-state) */
const MAX_MESSAGES = 20;
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 днів
const keyFor = (chatId) => `u:${chatId}:mem`;

export async function rememberUserMessage(env, chatId, text) {
  if (!env.LIKES_KV) return;
  const key = keyFor(chatId);
  const state = (await kvGetJSON(env.LIKES_KV, key, { messages: [] })) || { messages: [] };
  state.messages.push({ role: "user", text: String(text || ""), ts: Date.now() });
  if (state.messages.length > MAX_MESSAGES) state.messages = state.messages.slice(-MAX_MESSAGES);
  await kvPutJSON(env.LIKES_KV, key, state, TTL_SECONDS);
}
export async function rememberBotMessage(env, chatId, text) {
  if (!env.LIKES_KV) return;
  const key = keyFor(chatId);
  const state = (await kvGetJSON(env.LIKES_KV, key, { messages: [] })) || { messages: [] };
  state.messages.push({ role: "bot", text: String(text || ""), ts: Date.now() });
  if (state.messages.length > MAX_MESSAGES) state.messages = state.messages.slice(-MAX_MESSAGES);
  await kvPutJSON(env.LIKES_KV, key, state, TTL_SECONDS);
}
export async function getShortContext(env, chatId, limit = 6) {
  if (!env.LIKES_KV) return [];
  const state = await kvGetJSON(env.LIKES_KV, keyFor(chatId), { messages: [] });
  return (state?.messages || []).slice(-Math.max(0, limit));
}
export async function resetMemory(env, chatId) {
  if (!env.LIKES_KV || !chatId) return;
  await kvPutJSON(env.LIKES_KV, keyFor(chatId), { messages: [] }, TTL_SECONDS);
}