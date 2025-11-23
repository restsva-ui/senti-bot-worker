//////////////////////////////
// dialog.js — коротка пам'ять діалогу
//////////////////////////////

import { kvGet, kvSet } from "./kv.js";

const MAX_TURNS = 20;

export async function loadDialog(env, uid) {
  const arr = await kvGet(env, `dialog:${uid}`, []);
  return Array.isArray(arr) ? arr : [];
}

export async function saveDialog(env, uid, dialog) {
  let arr = Array.isArray(dialog) ? dialog : [];
  if (arr.length > MAX_TURNS) {
    arr = arr.slice(arr.length - MAX_TURNS);
  }
  await kvSet(env, `dialog:${uid}`, arr);
}
