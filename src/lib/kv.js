// Хелпери для KV (JSON + TTL)
export async function kvGetJSON(store, key, def = null) {
  const raw = await store.get(key);
  if (!raw) return def;
  try { return JSON.parse(raw); } catch { return def; }
}
export async function kvPutJSON(store, key, value, ttlSeconds) {
  const body = JSON.stringify(value);
  const opts = ttlSeconds ? { expirationTtl: ttlSeconds } : undefined;
  await store.put(key, body, opts);
}
export async function kvSetNX(store, key, value, ttlSeconds) {
  const exists = await store.get(key);
  if (exists) return false;
  const opts = ttlSeconds ? { expirationTtl: ttlSeconds } : undefined;
  await store.put(key, value, opts);
  return true;
}