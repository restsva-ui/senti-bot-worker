//////////////////////////////
// energy.js — енергосистема
//////////////////////////////

import { kvGet, kvSet } from "./kv.js";

export async function getEnergy(env, uid) {
  return (await kvGet(env, `energy:${uid}`, 20)) || 0;
}

export async function spendEnergy(env, uid, amount = 1) {
  const e = await getEnergy(env, uid);
  const left = Math.max(0, e - amount);
  await kvSet(env, `energy:${uid}`, left);
}

export async function giveEnergyBonus(env, uid, amount = 5) {
  const e = await getEnergy(env, uid);
  await kvSet(env, `energy:${uid}`, e + amount);
}
