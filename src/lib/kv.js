//////////////////////////////
// kv.js — обгортка над DIALOG_KV
//////////////////////////////

export async function kvGet(env, key, fallback = null) {
  const v = await env.DIALOG_KV.get(key);
  if (!v) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export async function kvSet(env, key, value) {
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  await env.DIALOG_KV.put(key, str);
}

export async function kvDel(env, key) {
  await env.DIALOG_KV.delete(key);
}
