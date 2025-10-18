// [1/3] src/lib/energyLog.js
// Журнал і щоденна статистика енергії.
const ensureLog = (env) => {
  if (!env.ENERGY_LOG_KV) throw new Error("ENERGY_LOG_KV binding missing");
  return env.ENERGY_LOG_KV;
};

const yyyyMmDdUtc = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString().slice(0, 10);

export async function logEnergyEvent(env, userId, { delta = 0, kind = "unknown", meta = null }) {
  const kv = ensureLog(env);
  const ts = Date.now();
  const day = yyyyMmDdUtc(new Date(ts));
  const base = `energy:${userId}`;
  const logKey = `${base}:log:${ts}`;
  const dayKey = `${base}:day:${day}`;

  const rec = { ts, kind, delta, meta: meta ?? null };
  await kv.put(logKey, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 14 }); // лог 14 днів

  // Агрегати по дню
  const dayRaw = await kv.get(dayKey);
  const agg = dayRaw ? JSON.parse(dayRaw) : { day, spent: 0, gained: 0, resets: 0, events: 0, lastTs: ts };
  if (delta < 0) agg.spent += Math.abs(delta);
  if (delta > 0) agg.gained += delta;
  if (kind === "reset") agg.resets += 1;
  agg.events += 1;
  agg.lastTs = ts;
  await kv.put(dayKey, JSON.stringify(agg), { expirationTtl: 60 * 60 * 24 * 60 }); // 60 днів
  return rec;
}

export async function getEnergyLogs(env, userId, { limit = 100 } = {}) {
  const kv = ensureLog(env);
  const prefix = `energy:${userId}:log:`;
  const list = await kv.list({ prefix });
  // за часом у зворотному порядку
  const keys = (list.keys || []).map(k => k.name).sort().reverse().slice(0, limit);
  const out = [];
  for (const k of keys) {
    const v = await kv.get(k);
    if (v) out.push(JSON.parse(v));
  }
  return out;
}

export async function getEnergyStats(env, userId, { days = 7 } = {}) {
  const kv = ensureLog(env);
  const base = `energy:${userId}:day:`;
  const today = new Date();
  const items = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = base + yyyyMmDdUtc(d);
    const v = await kv.get(key);
    if (v) items.push(JSON.parse(v));
  }
  return items.sort((a, b) => a.day.localeCompare(b.day));
}