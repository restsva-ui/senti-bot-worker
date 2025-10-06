import { addItem } from "./checklist.js";

/** Ключ прапорця автологування в KV */
const AUTOLOG_KEY = "autolog:enabled";
const TTL = 60 * 60 * 24 * 90; // 90 днів

export async function setAutolog(env, enabled) {
  if (!env.SENTI_CACHE) return false;
  await env.SENTI_CACHE.put(AUTOLOG_KEY, enabled ? "1" : "0", { expirationTtl: TTL });
  return enabled;
}

export async function getAutolog(env) {
  if (!env.SENTI_CACHE) return false;
  const v = await env.SENTI_CACHE.get(AUTOLOG_KEY);
  return v === "1";
}

/**
 * Якщо автологування увімкнено і повідомлення починається з '+',
 * записуємо текст (без '+') в чек-лист. Повертаємо true, якщо записали.
 */
export async function autologMaybe(env, fromId, text) {
  const enabled = await getAutolog(env);
  if (!enabled) return false;
  if (!text || typeof text !== "string") return false;

  const trimmed = text.trim();
  if (!trimmed.startsWith("+")) return false;

  const task = trimmed.replace(/^\+\s*/, "");
  if (!task) return false;

  await addItem(env, task, fromId);
  return true;
}
