// src/lib/energy.js
// Проста енергетична модель для користувачів (KV: STATE_KV).

const K = { PREFIX: "energy:user:" };
const nowSec = () => Math.floor(Date.now() / 1000);

function cfg(env) {
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  return {
    MAX: num(env.ENERGY_MAX, 100),                 // максимум енергії
    RECOVER_PER_MIN: num(env.ENERGY_RECOVER_PER_MIN, 1), // відновлення/хв
    COST_TEXT: num(env.ENERGY_COST_TEXT, 1),       // ціна текстової події
    COST_IMAGE: num(env.ENERGY_COST_IMAGE, 5),     // ціна обробки зображення
    LOW_THRESHOLD: num(env.ENERGY_LOW_THRESHOLD, 10),    // поріг "low mode"
  };
}

async function kvGetJSON(kv, key) {
  try {
    const raw = await kv.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function kvPutJSON(kv, key, val) {
  try {
    await kv.put(key, JSON.stringify(val), { expirationTtl: 60 * 60 * 24 * 7 }); // 7 днів
  } catch {}
}

function recoverEnergy(prev, now, perMin, max) {
  if (!prev?.updatedAt) return prev?.value ?? max;
  const dtMin = Math.max(0, Math.floor((now - prev.updatedAt) / 60));
  return Math.min(max, (prev.value ?? max) + dtMin * perMin);
}

/** Отримати поточну енергію (з авто-відновленням) */
export async function getEnergy(env, userId) {
  if (!env.STATE_KV) throw new Error("STATE_KV binding missing");
  const key = `${K.PREFIX}${userId}`;
  const c = cfg(env);
  const now = nowSec();
  const prev = await kvGetJSON(env.STATE_KV, key);
  const val = recoverEnergy(prev, now, c.RECOVER_PER_MIN, c.MAX);
  const cur = { value: val, updatedAt: now };
  await kvPutJSON(env.STATE_KV, key, cur);
  return cur.value;
}

/** Списати енергію за подію ("text" | "image") і повернути стан */
export async function spendEnergy(env, userId, kind = "text") {
  if (!env.STATE_KV) throw new Error("STATE_KV binding missing");
  const key = `${K.PREFIX}${userId}`;
  const c = cfg(env);
  const now = nowSec();
  const prev = await kvGetJSON(env.STATE_KV, key);
  let val = recoverEnergy(prev, now, c.RECOVER_PER_MIN, c.MAX);
  const cost = kind === "image" ? c.COST_IMAGE : c.COST_TEXT;
  val = Math.max(0, val - cost);
  const cur = { value: val, updatedAt: now };
  await kvPutJSON(env.STATE_KV, key, cur);
  const lowMode = val <= c.LOW_THRESHOLD;
  return { energy: val, lowMode, cfg: c };
}

/** Скинути енергію до MAX (адмін/сервісне) */
export async function resetEnergy(env, userId) {
  if (!env.STATE_KV) throw new Error("STATE_KV binding missing");
  const key = `${K.PREFIX}${userId}`;
  const c = cfg(env);
  const now = nowSec();
  const cur = { value: c.MAX, updatedAt: now };
  await kvPutJSON(env.STATE_KV, key, cur);
  return cur.value;
}