// src/lib/kvLearnQueue.js
// Проста черга для навчання в KV

const KEY = (uid) => `learn:queue:${uid}`;
const SYSKEY = `learn:queue:system`;

function normalizeItem(src = {}) {
  const id = src.id || crypto.randomUUID();
  const url = (src.url || "").trim();
  const name = (src.name || "").trim() || url || `item_${id}`;
  const when = src.when || Date.now();
  const type = src.type || (url ? "url" : "file");
  const status = src.status || "queued"; // queued | done | fail
  return { id, url, name, when, type, status };
}

export async function enqueueLearn(env, userId, item) {
  const kv = env?.LEARN_QUEUE_KV;
  if (!kv) throw new Error("LEARN_QUEUE_KV is not bound");
  const key = KEY(userId);
  let arr = [];
  try {
    const raw = await kv.get(key);
    if (raw) arr = JSON.parse(raw);
  } catch {}
  arr.push(normalizeItem(item));
  await kv.put(key, JSON.stringify(arr));
  return arr.length;
}

export async function listLearn(env, userId) {
  const kv = env?.LEARN_QUEUE_KV;
  if (!kv) throw new Error("LEARN_QUEUE_KV is not bound");
  const raw = await kv.get(KEY(userId));
  if (!raw) return [];
  try { return JSON.parse(raw) || []; } catch { return []; }
}

export async function clearLearn(env, userId) {
  const kv = env?.LEARN_QUEUE_KV;
  if (!kv) throw new Error("LEARN_QUEUE_KV is not bound");
  await kv.put(KEY(userId), JSON.stringify([]));
}

export async function enqueueSystemLearn(env, item) {
  const kv = env?.LEARN_QUEUE_KV;
  if (!kv) throw new Error("LEARN_QUEUE_KV is not bound");
  let arr = [];
  try { const raw = await kv.get(SYSKEY); if (raw) arr = JSON.parse(raw); } catch {}
  arr.push(normalizeItem(item));
  await kv.put(SYSKEY, JSON.stringify(arr));
  return arr.length;
}

export async function listSystemLearn(env) {
  const kv = env?.LEARN_QUEUE_KV;
  if (!kv) throw new Error("LEARN_QUEUE_KV is not bound");
  const raw = await kv.get(SYSKEY);
  if (!raw) return [];
  try { return JSON.parse(raw) || []; } catch { return []; }
}