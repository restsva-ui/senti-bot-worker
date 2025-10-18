// src/lib/geo.js

// Зберігаємо останню геолокацію користувача у KV (30 днів)
const GEO_KEY = (uid) => `geo:${uid}`;

export async function setUserLocation(env, userId, loc) {
  if (!env?.STATE_KV || !userId || !loc) return;
  const payload = {
    lat: Number(loc.latitude),
    lon: Number(loc.longitude),
    time: Date.now(),
  };
  try {
    await env.STATE_KV.put(GEO_KEY(userId), JSON.stringify(payload), {
      expirationTtl: 60 * 60 * 24 * 30, // 30 днів
    });
  } catch {}
}

export async function getUserLocation(env, userId) {
  if (!env?.STATE_KV || !userId) return null;
  try {
    const raw = await env.STATE_KV.get(GEO_KEY(userId));
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.lat === "number" && typeof v?.lon === "number") return v;
  } catch {}
  return null;
}