//////////////////////////////
// profile.js — профіль юзера
//////////////////////////////

import { kvGet, kvSet } from "./kv.js";

export async function getProfile(env, uid) {
  return await kvGet(env, `profile:${uid}`, null);
}

export async function saveProfile(env, profile) {
  return await kvSet(env, `profile:${profile.uid}`, profile);
}
