// [2/3] src/lib/energy.js
// Просте сховище стану енергії + логування подій.
import { logEnergyEvent } from "./energyLog.js";

const ensureState = (env) => {
  if (!env.STATE_KV) throw new Error("STATE_KV binding missing");
  return env.STATE_KV;
};

const K = (u) => `energy:${u}`;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

const ENV = (env) => ({
  max: Number(env.ENERGY_MAX ?? 100),
  recoverPerMin: Number(env.ENERGY_RECOVER_PER_MIN ?? 1),
  costText: Number(env.ENERGY_COST_TEXT ?? 1),
  costImage: Number(env.ENERGY_COST_IMAGE ?? 5),
  low: Number(env.ENERGY_LOW_THRESHOLD ?? 10),
});

export async function getEnergy(env, userId) {
  const kv = ensureState(env);
  const raw = await kv.get(K(userId));
  const cfg = ENV(env);
  if (!raw) {
    const rec = { v: cfg.max, ts: Date.now() };
    await kv.put(K(userId), JSON.stringify(rec));
    return { energy: cfg.max, ...cfg };
  }
  const rec = JSON.parse(raw);
  // пасивне відновлення
  const mins = Math.floor((Date.now() - (rec.ts || 0)) / 60000);
  if (mins > 0 && cfg.recoverPerMin > 0) {
    const add = mins * cfg.recoverPerMin;
    const v2 = clamp((rec.v ?? cfg.max) + add, 0, cfg.max);
    if (v2 !== rec.v) {
      await kv.put(K(userId), JSON.stringify({ v: v2, ts: Date.now() }));
      await logEnergyEvent(env, userId, { delta: (v2 - (rec.v ?? 0)), kind: "recover", meta: { mins } });
      return { energy: v2, ...cfg };
    }
  }
  return { energy: rec.v ?? cfg.max, ...cfg };
}

export async function resetEnergy(env, userId) {
  const kv = ensureState(env);
  const cfg = ENV(env);
  const rec = { v: cfg.max, ts: Date.now() };
  await kv.put(K(userId), JSON.stringify(rec));
  await logEnergyEvent(env, userId, { delta: cfg.max, kind: "reset" });
  return { energy: cfg.max, ...cfg };
}

export async function spendEnergy(env, userId, amount, kind = "spend") {
  const kv = ensureState(env);
  const cfg = ENV(env);
  const cur = await getEnergy(env, userId);
  const v2 = clamp(cur.energy - amount, 0, cfg.max);
  await kv.put(K(userId), JSON.stringify({ v: v2, ts: Date.now() }));
  await logEnergyEvent(env, userId, { delta: -amount, kind });
  return { energy: v2, ...cfg };
}