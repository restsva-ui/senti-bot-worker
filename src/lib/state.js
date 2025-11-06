// src/lib/state.js
// Стан: Redis HTTP (як є), або in-memory Map з TTL

const mem = new Map();
const TTL = 60 * 30; // 30 хв

function k(chatId, key) { return `${chatId}:${key}`; }

async function mget(chatId, key) {
  const item = mem.get(k(chatId, key));
  if (!item) return null;
  if (item.exp < Date.now()) { mem.delete(k(chatId, key)); return null; }
  return item.val;
}
async function mset(chatId, key, val) {
  mem.set(k(chatId, key), { val, exp: Date.now() + TTL * 1000 });
}
async function mdel(chatId, key) { mem.delete(k(chatId, key)); }

async function rfetch(env, path, payload) {
  const url = `${env.REDIS_URL}${path}`;
  const headers = { "content-type": "application/json" };
  if (env.REDIS_TOKEN) headers.Authorization = `Bearer ${env.REDIS_TOKEN}`;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Redis error ${res.status}`);
  return res.json();
}

export async function getState(env, chatId, key) {
  if (env.REDIS_URL) {
    try { const r = await rfetch(env, "/get", { key: k(chatId, key) }); return r?.result ?? null; }
    catch { /* fallback */ }
  }
  return mget(chatId, key);
}

export async function setState(env, chatId, key, value) {
  if (env.REDIS_URL) {
    try { await rfetch(env, "/set", { key: k(chatId, key), value, ttl: TTL }); return; }
    catch { /* fallback */ }
  }
  return mset(chatId, key, value);
}

export async function clearState(env, chatId, key) {
  if (env.REDIS_URL) {
    try { await rfetch(env, "/del", { key: k(chatId, key) }); return; }
    catch { /* fallback */ }
  }
  return mdel(chatId, key);
}