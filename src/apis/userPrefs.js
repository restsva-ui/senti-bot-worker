// src/apis/userPrefs.js

// Ключі в KV
const LAST_PLACE_KEY = (uid) => `weather:last-place:${uid}`;

/**
 * Зберегти останнє місце користувача для погоди.
 * @param {Env} env
 * @param {string|number} userId
 * @param {{ place?: string, lat?: number, lon?: number, tz?: string }} value
 */
export async function saveLastPlace(env, userId, value = {}) {
  try {
    const safe = {
      place: value.place || "",
      lat: typeof value.lat === "number" ? value.lat : undefined,
      lon: typeof value.lon === "number" ? value.lon : undefined,
      tz: value.tz || undefined
    };
    await env.STATE_KV.put(LAST_PLACE_KEY(userId), JSON.stringify(safe));
  } catch {}
}

/**
 * Прочитати останнє місце користувача для погоди.
 * @param {Env} env
 * @param {string|number} userId
 * @returns {Promise<{ place?: string, lat?: number, lon?: number, tz?: string }|null>}
 */
export async function loadLastPlace(env, userId) {
  try {
    const raw = await env.STATE_KV.get(LAST_PLACE_KEY(userId));
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || (typeof v !== "object")) return null;
    return v;
  } catch {
    return null;
  }
}