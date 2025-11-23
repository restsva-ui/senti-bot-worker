//////////////////////////////
// journal.js — Learn Lite
//////////////////////////////

import { kvGet, kvSet } from "./kv.js";

export async function addInsight(env, uid, text) {
  const list = await kvGet(env, `learn:${uid}`, []);
  list.push({ text, time: Date.now() });

  if (list.length > 50) list.shift();

  return kvSet(env, `learn:${uid}`, list);
}
