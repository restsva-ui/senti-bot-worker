// src/lib/memory.js
// Пам'ять Senti у LIKES_KV:
//  - короткий контекст розмови (останні репліки)
//  - довготривалі факти про користувача
//  - службові утиліти для нічних авто-поліпшень (перелік чатів тощо)

import { kvGetJSON, kvPutJSON } from "./kv.js";

// ─────────────────────────────────────────────────────────────────────────────
// Налаштування
// ─────────────────────────────────────────────────────────────────────────────
const MAX_MESSAGES = 20;               // скільки реплік тримати у контексті
const TTL_SECONDS = 60 * 60 * 24 * 7;  // 7 днів для контексту
const FACTS_TTL  = 60 * 60 * 24 * 90;  // 90 днів для фактів

// Ключі в KV
const ctxKey   = (chatId) => `u:${chatId}:mem`;
const factsKey = (userId) => `u:${userId}:facts`;

// ─────────────────────────────────────────────────────────────────────────────
// Допоміжне
// ─────────────────────────────────────────────────────────────────────────────
const safeArr = (v, fallback = []) => (Array.isArray(v) ? v : fallback);
const nowTs   = () => Date.now();

function dedupeStrings(list) {
  const set = new Set(list.map((s) => String(s || "").trim()).filter(Boolean));
  return [...set];
}

/** Нормалізація ролі під формат chat-completions */
function normalizeRole(role) {
  return role === "user" ? "user" : "assistant";
}

/** Безпечний put для LIKES_KV з TTL */
async function putCtx(env, chatId, messages) {
  if (!env.LIKES_KV) return;
  const trimmed = safeArr(messages).slice(-MAX_MESSAGES);
  await kvPutJSON(env.LIKES_KV, ctxKey(chatId), { messages: trimmed }, TTL_SECONDS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Коротка пам'ять (контекст)
// ─────────────────────────────────────────────────────────────────────────────

/** Додати повідомлення користувача у контекст */
export async function rememberUserMessage(env, chatId, text) {
  if (!env.LIKES_KV) return;
  const key = ctxKey(chatId);
  const state = (await kvGetJSON(env.LIKES_KV, key, { messages: [] })) || { messages: [] };
  const messages = safeArr(state.messages);
  messages.push({ role: "user", text: String(text || ""), ts: nowTs() });
  await putCtx(env, chatId, messages);
}

/** Додати відповідь асистента у контекст */
export async function rememberBotMessage(env, chatId, text) {
  if (!env.LIKES_KV) return;
  const key = ctxKey(chatId);
  const state = (await kvGetJSON(env.LIKES_KV, key, { messages: [] })) || { messages: [] };
  const messages = safeArr(state.messages);
  messages.push({ role: "assistant", text: String(text || ""), ts: nowTs() });
  await putCtx(env, chatId, messages);
}

/** Додати повідомлення довільної ролі ('user' | 'assistant') */
export async function pushContext(env, chatId, role, text) {
  if (!env.LIKES_KV) return [];
  const key = ctxKey(chatId);
  const state = (await kvGetJSON(env.LIKES_KV, key, { messages: [] })) || { messages: [] };
  const messages = safeArr(state.messages);
  messages.push({ role: normalizeRole(role), text: String(text || ""), ts: nowTs() });
  await putCtx(env, chatId, messages);
  return messages.slice(-MAX_MESSAGES);
}

/** Останні N реплік контексту (за замовчуванням 6) */
export async function getShortContext(env, chatId, limit = 6) {
  if (!env.LIKES_KV) return [];
  const state = await kvGetJSON(env.LIKES_KV, ctxKey(chatId), { messages: [] });
  const msgs = safeArr(state?.messages);
  const n = Math.max(0, Number(limit) || 0);
  return n ? msgs.slice(-n) : msgs;
}

/** Увесь доступний контекст (до MAX_MESSAGES) */
export async function loadContext(env, chatId) {
  return getShortContext(env, chatId, MAX_MESSAGES);
}

/** Скинути контекст для чату */
export async function resetMemory(env, chatId) {
  if (!env.LIKES_KV || !chatId) return;
  await kvPutJSON(env.LIKES_KV, ctxKey(chatId), { messages: [] }, TTL_SECONDS);
}

/** Перетворити контекст у “людський” транскрипт */
export function contextToTranscript(context = []) {
  return safeArr(context)
    .map((m) => `${m.role === "user" ? "Користувач" : "Senti"}: ${m.text}`)
    .join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Довготривалі “факти” про користувача
// ─────────────────────────────────────────────────────────────────────────────

/** Отримати список фактів */
export async function recallFacts(env, userId) {
  if (!env.LIKES_KV) return [];
  const arr = await kvGetJSON(env.LIKES_KV, factsKey(userId), []);
  return safeArr(arr);
}

/** Додати 1..N фактів (рядки). Дублікати прибираються. */
export async function rememberFacts(env, userId, facts) {
  if (!env.LIKES_KV) return [];
  const cur = await recallFacts(env, userId);
  const next = dedupeStrings(cur.concat(safeArr(facts)));
  await kvPutJSON(env.LIKES_KV, factsKey(userId), next, FACTS_TTL);
  return next;
}

/** Видалити факти, що містять підрядок fragment (case-insensitive) */
export async function forgetFact(env, userId, fragment) {
  if (!env.LIKES_KV) return [];
  const cur = await recallFacts(env, userId);
  const needle = String(fragment || "").toLowerCase();
  const next = cur.filter((s) => !String(s).toLowerCase().includes(needle));
  await kvPutJSON(env.LIKES_KV, factsKey(userId), next, FACTS_TTL);
  return next;
}

/** Повністю обнулити факти користувача */
export async function resetFacts(env, userId) {
  if (!env.LIKES_KV) return;
  await kvPutJSON(env.LIKES_KV, factsKey(userId), [], FACTS_TTL);
}

// ─────────────────────────────────────────────────────────────────────────────
// Сервісні утиліти для авто-агентів (нічні поліпшення тощо)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Порахувати кількість чатів, для яких є контекст.
 * Використовує KV.list з префіксом "u:" та суфіксом ":mem".
 */
export async function countChats(env) {
  if (!env.LIKES_KV || typeof env.LIKES_KV.list !== "function") return 0;
  let cursor;
  let total = 0;
  do {
    // Workers KV не підтримує пошук за суфіксом, тому фільтруємо в коді
    const { keys, list_complete, cursor: next } = await env.LIKES_KV.list({
      prefix: "u:",
      cursor,
      limit: 1000,
    });
    total += (keys || []).filter((k) => k?.name?.endsWith(":mem")).length;
    cursor = list_complete ? undefined : next;
  } while (cursor);
  return total;
}

/**
 * Повернути ідентифікатори чатів (рядки) для яких збережено контекст.
 * maxCount обмежує кількість (щоб не бігти по всій KV при великих об'ємах).
 */
export async function listChatIds(env, maxCount = 1000) {
  const out = [];
  if (!env.LIKES_KV || typeof env.LIKES_KV.list !== "function") return out;

  let cursor;
  do {
    const { keys, list_complete, cursor: next } = await env.LIKES_KV.list({
      prefix: "u:",
      cursor,
      limit: 1000,
    });
    for (const k of keys || []) {
      const name = k?.name || "";
      if (name.endsWith(":mem")) {
        // name вигляду "u:<chatId>:mem"
        const chatId = name.slice(2, -4); // прибрати "u:" і ":mem"
        if (chatId) out.push(chatId);
        if (out.length >= maxCount) return out;
      }
    }
    cursor = list_complete ? undefined : next;
  } while (cursor);

  return out;
}

/**
 * Завантажити контекст по багатьох чатах (для нічного аналізу).
 * Повертає масив { chatId, messages }.
 */
export async function loadContextsBatch(env, chatIds = [], perChatLimit = 12) {
  const out = [];
  for (const chatId of safeArr(chatIds)) {
    const messages = await getShortContext(env, chatId, perChatLimit);
    if (messages.length) out.push({ chatId, messages });
  }
  return out;
}

// Експортуємо налаштування – іншим модулям може знадобитися знати обмеження
export const MemoryConfig = {
  MAX_MESSAGES,
  TTL_SECONDS,
  FACTS_TTL,
};