// src/lib/photoMemory.js
// Уніфікований доступ до пам'яті фото (останнi 20), сумісний з webhook.js.

const KEY = (uid) => `vision:mem:${uid}`;

export async function loadPhotoMemory(env, userId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return [];
  try {
    const raw = await kv.get(KEY(userId), "text");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function savePhotoMemory(env, userId, entry) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  try {
    const cur = await loadPhotoMemory(env, userId);
    cur.unshift({
      id: entry.id,
      url: entry.url,
      caption: entry.caption || "",
      desc: entry.desc || "",
      ts: Date.now()
    });
    await kv.put(KEY(userId), JSON.stringify(cur.slice(0, 20)),
      { expirationTtl: 60 * 60 * 24 * 180 }); // 180 днів
  } catch {}
}