//////////////////////////////
// energy.js — проста енергосистема Senti-Lite
//////////////////////////////

import { kvGet, kvSet } from "./kv.js";

const DEFAULT_ENERGY = 30;

export async function getEnergy(env, uid) {
  const val = await kvGet(env, `energy:${uid}`, DEFAULT_ENERGY);
  return typeof val === "number" ? val : Number(val || 0);
}

export async function spendEnergy(env, uid, amount = 1) {
  const current = await getEnergy(env, uid);
  const left = Math.max(0, current - amount);
  await kvSet(env, `energy:${uid}`, left);
  return left;
}

export async function giveEnergyBonus(env, uid, amount = 5) {
  const current = await getEnergy(env, uid);
  const next = current + amount;
  await kvSet(env, `energy:${uid}`, next);
  return next;
}
