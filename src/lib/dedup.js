import { kvSetNX } from "./kv.js";

/** Захист від повторних апдейтів Telegram (ретраї) — TTL 120с */
export async function seenUpdate(env, chatId, updateId) {
  if (!env.DEDUP_KV || !chatId || !updateId) return false;
  const key = `d:${chatId}:${updateId}`;
  const ok = await kvSetNX(env.DEDUP_KV, key, "1", 120);
  return !ok; // true => вже бачили
}