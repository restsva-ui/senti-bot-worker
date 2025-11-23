//////////////////////////////
// referrals.js — реферали
//////////////////////////////

import { kvGet, kvSet } from "./kv.js";

export async function addReferral(env, ownerUid, invitedUid) {
  let data = await kvGet(env, `ref:${ownerUid}`, []);

  if (!data.includes(invitedUid)) {
    data.push(invitedUid);
    await kvSet(env, `ref:${ownerUid}`, data);
  }
}

export async function getReferralStats(env, uid) {
  const list = await kvGet(env, `ref:${uid}`, []);
  return { count: list.length };
}
