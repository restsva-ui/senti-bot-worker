//////////////////////////////
// kv.js — обгортка KV
//////////////////////////////

export async function kvGet(env, key, fallback = null) {
  const v = await env.SENTI_KV.get(key);
  if (!v) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export async function kvSet(env, key, value) {
  if (typeof value === "object") {
    await env.SENTI_KV.put(key, JSON.stringify(value));
  } else {
    await env.SENTI_KV.put(key, value);
  }
}

export async function kvDel(env, key) {
  await env.SENTI_KV.delete(key);
}
