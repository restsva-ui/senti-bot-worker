// src/lib/kv.js

/**
 * УВАГА: для автологування використовуємо ТІЛЬКИ STATE_KV.
 * TODO/чеклист зберігатимемо у TODO_KV (senti-cache) – окремо.
 *
 * Цей модуль дає стабільні обгортки навколо Cloudflare KV
 * з нормальними помилками й єдиними ключами.
 */

// === Ключі у KV
const KEY_AUTOLOG = "autolog:enabled"; // "1" | "0"

// ---- helpers
function _boolToStr(b) { return b ? "1" : "0"; }
function _strToBool(s) { return s === "1"; }

// ---------------------------------------------------------------------------
// Автологування у STATE_KV
// ---------------------------------------------------------------------------

/**
 * Прочитати статус автологування з STATE_KV.
 * @returns {Promise<boolean>}
 */
export async function getAutolog(env) {
  try {
    if (!env?.STATE_KV) throw new Error("STATE_KV binding is missing");
    const v = await env.STATE_KV.get(KEY_AUTOLOG);
    // за замовчуванням вимкнено
    return _strToBool(v || "0");
  } catch (e) {
    // лог у консоль воркера – видно в Cloudflare Logs
    console.error("[getAutolog] KV error:", e?.message || e);
    return false;
  }
}

/**
 * Встановити статус автологування у STATE_KV.
 * @param {boolean} enabled
 * @returns {Promise<boolean>} true якщо запис успішний
 */
export async function setAutolog(env, enabled) {
  try {
    if (!env?.STATE_KV) throw new Error("STATE_KV binding is missing");
    await env.STATE_KV.put(KEY_AUTOLOG, _boolToStr(enabled));
    return true;
  } catch (e) {
    console.error("[setAutolog] KV error:", e?.message || e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Універсальні гетери/сетери (рядкові значення)
// ---------------------------------------------------------------------------

/** Безпечне читання з довільного KV binding’у (повертає string|null) */
export async function kvGet(env, bindingName, key) {
  try {
    const kv = env?.[bindingName];
    if (!kv) throw new Error(`KV binding '${bindingName}' is missing`);
    return await kv.get(key);
  } catch (e) {
    console.error(`[kvGet:${bindingName}]`, key, e?.message || e);
    return null;
  }
}

/** Безпечний запис у довільний KV binding (string value) */
export async function kvPut(env, bindingName, key, value, options) {
  try {
    const kv = env?.[bindingName];
    if (!kv) throw new Error(`KV binding '${bindingName}' is missing`);
    await kv.put(key, value, options);
    return true;
  } catch (e) {
    console.error(`[kvPut:${bindingName}]`, key, e?.message || e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// JSON-обгортки (використовуються пам'яттю/нічними імпрувами)
// Працюють безпосередньо з інстансом KV (наприклад, env.LIKES_KV)
// ---------------------------------------------------------------------------

/**
 * kvGetJSON(kv, key, fallback?)
 * Прочитати JSON з KV. Якщо ключа немає або JSON зіпсовано — повертає fallback.
 */
export async function kvGetJSON(kv, key, fallback = null) {
  try {
    if (!kv) throw new Error("KV binding instance is missing");
    const v = await kv.get(key);
    if (!v) return fallback;
    try {
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  } catch (e) {
    console.error("[kvGetJSON]", key, e?.message || e);
    return fallback;
  }
}

/**
 * kvPutJSON(kv, key, obj, ttlSeconds?)
 * Записати об'єкт у KV як JSON. Повертає true/false.
 * ttlSeconds (number) — необов'язковий, задає expirationTtl.
 */
export async function kvPutJSON(kv, key, obj, ttlSeconds) {
  try {
    if (!kv) throw new Error("KV binding instance is missing");
    const options =
      typeof ttlSeconds === "number" && isFinite(ttlSeconds)
        ? { expirationTtl: ttlSeconds }
        : undefined;
    await kv.put(key, JSON.stringify(obj), options);
    return true;
  } catch (e) {
    console.error("[kvPutJSON]", key, e?.message || e);
    return false;
  }
}