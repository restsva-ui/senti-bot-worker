// src/lib/dialogMemory.js
// Adapter-шар для зворотної сумісності.
// Проксі до memory.js, щоб старі імпорти не ламалися.
//
// API (як і було):
//   await pushTurn(env, userId, role, text)
//   await getRecentTurns(env, userId, limit?)
//   await buildDialogHint(env, userId, opts?)

import { getShortContext, pushContext } from "./memory.js";

const TURN_LIMIT_DEFAULT = 14;   // збережено для сумісності (не використовується тут)
const HINT_TURNS_DEFAULT = 8;

// Додати репліку у пам'ять (використовуємо userId як chatId — як у Telegram це збігається)
export async function pushTurn(env, userIdRaw, role, text, _limit = TURN_LIMIT_DEFAULT) {
  const chatId = String(userIdRaw || env.TELEGRAM_ADMIN_ID || "0");
  try {
    await pushContext(env, chatId, role === "assistant" ? "assistant" : "user", String(text || ""));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Повернути останні N реплік (у форматі {role,text,ts?})
export async function getRecentTurns(env, userIdRaw, limit = HINT_TURNS_DEFAULT) {
  const chatId = String(userIdRaw || env.TELEGRAM_ADMIN_ID || "0");
  try {
    const ctx = await getShortContext(env, chatId, Math.max(2, Number(limit || HINT_TURNS_DEFAULT)));
    // ctx вже містить {role,text,ts}; повертаємо як є
    return Array.isArray(ctx) ? ctx : [];
  } catch {
    return [];
  }
}

// Побудувати компактний блок діалогу для system prompt
export async function buildDialogHint(env, userIdRaw, opts = {}) {
  const maxTurns = Math.max(2, Number(opts.maxTurns || HINT_TURNS_DEFAULT));
  const chatId = String(userIdRaw || env.TELEGRAM_ADMIN_ID || "0");

  const turns = await getShortContext(env, chatId, maxTurns);
  if (!turns?.length) return "";

  const lines = ["[Dialog memory — recent turns]"];
  for (const m of turns) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const s = String(m.text || "").replace(/\s+/g, " ").trim().slice(0, 300);
    lines.push(`${role}: ${s}`);
  }
  lines.push("— End of dialog memory. Keep answers consistent with it.");
  return lines.join("\n");
}