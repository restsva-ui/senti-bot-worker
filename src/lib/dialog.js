//////////////////////////////
// dialog.js — пам'ять діалогу
//////////////////////////////

import { kvGet, kvSet } from "./kv.js";

export async function loadDialog(env, uid) {
  return (await kvGet(env, `dialog:${uid}`, [])) || [];
}

export async function saveDialog(env, uid, dialog) {
  // залишаємо лише останні 20 повідомлень
  if (dialog.length > 20) dialog = dialog.slice(dialog.length - 20);
  return kvSet(env, `dialog:${uid}`, dialog);
}
