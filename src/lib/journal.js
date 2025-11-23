//////////////////////////////
// journal.js — Learn Lite (інсайти)
//////////////////////////////

import { kvGet, kvSet } from "./kv.js";

const MAX_INSIGHTS = 50;

export async function addInsight(env, uid, text) {
  let list = await kvGet(env, `learn:${uid}`, []);
  if (!Array.isArray(list)) list = [];
  list.push({ text, time: Date.now() });
  if (list.length > MAX_INSIGHTS) {
    list = list.slice(list.length - MAX_INSIGHTS);
  }
  await kvSet(env, `learn:${uid}`, list);
}
