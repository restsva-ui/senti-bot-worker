// src/lib/energy.js
// Уніфікована енергетика з авто-відновленням (працює через STATE_KV).

function ensureState(env) {
  if (!env.STATE_KV) throw new Error("STATE_KV binding missing");
  return env.STATE_KV;
}

export function energyCfg(env) {
  return {
    max: Number(env.ENERGY_MAX ?? 100),
    recoverPerMin: Number(env.ENERGY_RECOVER_PER_MIN ?? 1),
    costText: Number(env.ENERGY_COST_TEXT ?? 1),
    costImage: Number(env.ENERGY_COST_IMAGE ?? 5),
    low: Number(env.ENERGY_LOW_THRESHOLD ?? 10),
  };
}

const ENERGY_KEY = (uid) => `energy:${uid}`;

export async function getEnergy(env, userId) {
  const kv = ensureState(env);
  const raw = await kv.get(ENERGY_KEY(userId));
  const cfg = energyCfg(env);

  if (!raw) {
    const rec = { v: cfg.max, ts: Date.now() };
    await kv.put(ENERGY_KEY(userId), JSON.stringify(rec));
    return cfg.max;
  }

  const rec = JSON.parse(raw);
  const mins = Math.floor((Date.now() - (rec.ts || 0)) / 60000);

  if (mins > 0 && cfg.recoverPerMin > 0) {
    const add = mins * cfg.recoverPerMin;
    const v2 = Math.max(0, Math.min(cfg.max, (rec.v ?? cfg.max) + add));
    if (v2 !== rec.v) {
      await kv.put(ENERGY_KEY(userId), JSON.stringify({ v: v2, ts: Date.now() }));
      return v2;
    }
  }
  return rec.v ?? cfg.max;
}

export async function setEnergy(env, userId, v) {
  await ensureState(env).put(ENERGY_KEY(userId), JSON.stringify({ v, ts: Date.now() }));
  return v;
}

export async function spendEnergy(env, userId, cost) {
  const cfg = energyCfg(env);
  const cur = await getEnergy(env, userId);
  if (cur < cost) return { ok: false, cur, need: cost, cfg };
  const left = Math.max(0, cur - cost);
  await setEnergy(env, userId, left);
  return { ok: true, cur: left, cfg };
}
