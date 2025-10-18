import { kvGetJSON, kvPutJSON } from "./kv.js";

/** Журнал активності у SENTI_CACHE: остання відповідь + лічильники */
const TTL = 60 * 60 * 24 * 30; // 30 днів

const keyFor = (chatId) => `act:${chatId}`;

export async function logReply(env, chatId) {
  if (!env.SENTI_CACHE) return;
  const key = keyFor(chatId);
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  const st = (await kvGetJSON(env.SENTI_CACHE, key, { last_ts: 0, total: 0, by_day: {} })) || {
    last_ts: 0, total: 0, by_day: {}
  };
  st.last_ts = now;
  st.total += 1;
  st.by_day[today] = (st.by_day[today] || 0) + 1;

  await kvPutJSON(env.SENTI_CACHE, key, st, TTL);
  return st;
}

export async function getStatus(env, chatId) {
  if (!env.SENTI_CACHE) return { last_ts: 0, total: 0, by_day: {} };
  const st = await kvGetJSON(env.SENTI_CACHE, keyFor(chatId), { last_ts: 0, total: 0, by_day: {} });
  return st || { last_ts: 0, total: 0, by_day: {} };
}