//////////////////////////////
// stats.js — статистика юзера
//////////////////////////////

import { kvGet, kvSet } from "./kv.js";

const KEY = (uid) => `stats:${uid}`;

export async function getStats(env, uid) {
  const d = await kvGet(env, KEY(uid), null);
  return (
    d || {
      messages: 0,
      photos: 0,
      lastSeen: 0,
    }
  );
}

export async function incMessages(env, uid) {
  const st = await getStats(env, uid);
  st.messages++;
  st.lastSeen = Date.now();
  await kvSet(env, KEY(uid), st);
}

export async function incPhotos(env, uid) {
  const st = await getStats(env, uid);
  st.photos++;
  st.lastSeen = Date.now();
  await kvSet(env, KEY(uid), st);
}
