// src/lib/energy.js
import { logEnergyEvent } from "./energyLog.js";
import { abs } from "../utils/url.js";

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

// ✅ конфігурація
export const energyCfg = (env) => ENV(env);

// ✅ посилання для сторінок
export function energyLinks(env, userId) {
  const s = env.WEBHOOK_SECRET || "";
  const qs = `s=${encodeURIComponent(s)}&u=${encodeURIComponent(String(userId || ""))}`;
  return {
    energy: abs(env, `/admin/energy/html?${qs}`),
    checklist: abs(env, `/admin/checklist/html?${qs}`),
  };
}

// ✅ поточна енергія з пасивним відновленням
export async function getEnergy(env, userId) {
  const kv = ensureState(env);
  const raw = await kv.get(K(userId));
  const cfg = ENV(env);

  if (!raw) {
    const rec = { v: cfg.max, ts: Date.now() };
    await kv.put(K(userId), JSON.stringify(rec));
    return { energy: cfg.max, ...cfg };
  }

  let rec;
  try { rec = JSON.parse(raw); } catch { rec = { v: cfg.max, ts: Date.now() }; }

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

// ✅ скидання
export async function resetEnergy(env, userId) {
  const kv = ensureState(env);
  const cfg = ENV(env);
  const rec = { v: cfg.max, ts: Date.now() };
  await kv.put(K(userId), JSON.stringify(rec));
  await logEnergyEvent(env, userId, { delta: cfg.max, kind: "reset" });
  return { energy: cfg.max, ...cfg };
}

// ✅ списання (контракт вебхука)
export async function spendEnergy(env, userId, amount, kind = "spend") {
  const kv = ensureState(env);
  const cfg = ENV(env);
  const curInfo = await getEnergy(env, userId);
  const cur = curInfo.energy;

  if (cur < amount) {
    return { ok: false, cur, need: amount, cfg };
  }

  const v2 = clamp(cur - amount, 0, cfg.max);
  await kv.put(K(userId), JSON.stringify({ v: v2, ts: Date.now() }));
  await logEnergyEvent(env, userId, { delta: -amount, kind });
  return { ok: true, cur: v2, cfg };
}