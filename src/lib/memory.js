// src/lib/memory.js
import { kvGetJSON, kvPutJSON } from "./kv.js";

/**
 * Пам'ять у LIKES_KV (senti-state)
 * - коротка історія повідомлень у чаті (контекст)
 * - довготривалі факти про користувача
 */

// ---- Налаштування -----------------------------------------------------------
const MAX_MESSAGES = 20;                 // скільки реплік тримати у контексті
const TTL_SECONDS = 60 * 60 * 24 * 7;    // 7 днів для контексту
const FACTS_TTL = 60 * 60 * 24 * 90;     // 90 днів для фактів

const ctxKey = (chatId) => `u:${chatId}:mem`;
const factsKey = (userId) => `u:${userId}:facts`;

// ---- Допоміжне --------------------------------------------------------------
function safeArr(v, fallback = []) {
  return Array.isArray(v) ? v : fallback;
}
function dedupeStrings(list) {
  const set = new Set(list.map(s => String(s || "").trim()).filter(Boolean));
  return [...set];
}

// ---- Контекст (коротка пам'ять чату) ---------------------------------------

/** Додати повідомлення користувача у контекст */
export async function rememberUserMessage(env, chatId, text) {
  if (!env.LIKES_KV) return;
  const key = ctxKey(chatId);
  const state = (await kvGetJSON(env.LIKES_KV, key, { messages: [] })) || { messages: [] };
  const messages = safeArr(state.messages);
  messages.push({ role: "user", text: String(text || ""), ts: Date.now() });
  const trimmed = messages.slice(-MAX_MESSAGES);
  await kvPutJSON(env.LIKES_KV, key, { messages: trimmed }, TTL_SECONDS);
}

/** Додати повідомлення бота/асистента у контекст */
export async function rememberBotMessage(env, chatId, text) {
  if (!env.LIKES_KV) return;
  const key = ctxKey(chatId);
  const state = (await kvGetJSON(env.LIKES_KV, key, { messages: [] })) || { messages: [] };
  const messages = safeArr(state.messages);
  // нормалізуємо role до 'assistant' (раніше використовувалось 'bot')
  messages.push({ role: "assistant", text: String(text || ""), ts: Date.now() });
  const trimmed = messages.slice(-MAX_MESSAGES);
  await kvPutJSON(env.LIKES_KV, key, { messages: trimmed }, TTL_SECONDS);
}

/** Додати повідомлення будь-якої ролі ('user' | 'assistant') */
export async function pushContext(env, chatId, role, text) {
  if (role !== "user" && role !== "assistant") role = "assistant";
  if (!env.LIKES_KV) return [];
  const key = ctxKey(chatId);
  const state = (await kvGetJSON(env.LIKES_KV, key, { messages: [] })) || { messages: [] };
  const messages = safeArr(state.messages);
  messages.push({ role, text: String(text || ""), ts: Date.now() });
  const trimmed = messages.slice(-MAX_MESSAGES);
  await kvPutJSON(env.LIKES_KV, key, { messages: trimmed }, TTL_SECONDS);
  return trimmed;
}

/** Отримати останні N повідомлень контексту */
export async function getShortContext(env, chatId, limit = 6) {
  if (!env.LIKES_KV) return [];
  const state = await kvGetJSON(env.LIKES_KV, ctxKey(chatId), { messages: [] });
  const msgs = safeArr(state?.messages);
  const n = Math.max(0, Number(limit) || 0);
  return n ? msgs.slice(-n) : msgs;
}

/** Отримати весь збережений контекст (до MAX_MESSAGES) */
export async function loadContext(env, chatId) {
  return getShortContext(env, chatId, MAX_MESSAGES);
}

/** Скинути пам'ять (контекст) для чату */
export async function resetMemory(env, chatId) {
  if (!env.LIKES_KV || !chatId) return;
  await kvPutJSON(env.LIKES_KV, ctxKey(chatId), { messages: [] }, TTL_SECONDS);
}

/** Зручний перетворювач контексту у текстовий транскрипт */
export function contextToTranscript(context = []) {
  return safeArr(context)
    .map(m => `${m.role === "user" ? "Користувач" : "Senti"}: ${m.text}`)
    .join("\n");
}

// ---- Довготривалі факти про користувача ------------------------------------

/** Повернути список фактів про користувача */
export async function recallFacts(env, userId) {
  if (!env.LIKES_KV) return [];
  const arr = await kvGetJSON(env.LIKES_KV, factsKey(userId), []);
  return safeArr(arr);
}

/** Додати 1..N фактів (рядки). Уникає дублікатів. */
export async function rememberFacts(env, userId, facts) {
  if (!env.LIKES_KV) return;
  const cur = await recallFacts(env, userId);
  const next = dedupeStrings(cur.concat(safeArr(facts)));
  await kvPutJSON(env.LIKES_KV, factsKey(userId), next, FACTS_TTL);
  return next;
}

/** Видалити факти, що містять фрагмент (case-insensitive). Повертає актуальний список. */
export async function forgetFact(env, userId, fragment) {
  if (!env.LIKES_KV) return [];
  const cur = await recallFacts(env, userId);
  const needle = String(fragment || "").toLowerCase();
  const next = cur.filter(s => !String(s).toLowerCase().includes(needle));
  await kvPutJSON(env.LIKES_KV, factsKey(userId), next, FACTS_TTL);
  return next;
}

/** Повністю очистити факти користувача */
export async function resetFacts(env, userId) {
  if (!env.LIKES_KV) return;
  await kvPutJSON(env.LIKES_KV, factsKey(userId), [], FACTS_TTL);
}