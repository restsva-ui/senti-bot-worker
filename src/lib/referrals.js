//////////////////////////////
// referrals.js — проста реферальна система
//////////////////////////////

import { kvGet, kvSet } from "./kv.js";

export async function addReferral(env, ownerUid, invitedUid) {
  let list = await kvGet(env, `ref:${ownerUid}`, []);
  if (!Array.isArray(list)) list = [];
  if (!list.includes(invitedUid)) {
    list.push(invitedUid);
    await kvSet(env, `ref:${ownerUid}`, list);
  }
}

export async function getReferralStats(env, uid) {
  const list = await kvGet(env, `ref:${uid}`, []);
  return { count: Array.isArray(list) ? list.length : 0 };
}
