//////////////////////////////
// photos.js — історія фото юзера
//////////////////////////////

import { kvGet, kvSet } from "./kv.js";

const INDEX = (uid) => `photo:index:${uid}`;
const ITEM = (uid, id) => `photo:${uid}:${id}`;

const MAX = 10;

export async function addPhoto(env, uid, base64) {
  let index = await kvGet(env, INDEX(uid), []);
  if (!Array.isArray(index)) index = [];

  const id = Date.now().toString(36);

  // зберігаємо фотку
  await kvSet(env, ITEM(uid, id), base64);

  // оновлюємо index
  index.push(id);
  if (index.length > MAX) index = index.slice(index.length - MAX);

  await kvSet(env, INDEX(uid), index);
}

export async function getPhotoHistory(env, uid) {
  const index = (await kvGet(env, INDEX(uid), [])) || [];
  const out = [];

  for (const id of index) {
    const base64 = await kvGet(env, ITEM(uid, id), null);
    if (base64) {
      out.push({
        id,
        base64,
      });
    }
  }

  return out;
}
