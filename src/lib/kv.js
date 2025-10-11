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

// ---- Автологування у STATE_KV

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

// ---- Додатково: універсальні гетери/сетери (можуть згодитись далі)

/** Безпечне читання з довільного KV binding’у */
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

/** Безпечний запис у довільний KV binding */
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

/* ============================================================================
 * JSON-обгортки (використовуються пам’яттю / ін. модулями)
 * Працюють безпосередньо з інстансом KV (env.X_KV), а не з назвою binding’у.
 * ==========================================================================*/

/**
 * Прочитати JSON з KV.
 * @param {KVNamespace} kv - binding (напр. env.STATE_KV)
 * @param {string} key
 * @param {any} [fallback=null] - значення за замовчуванням у разі помилки/відсутності
 * @returns {Promise<any>}
 */
export async function kvGetJSON(kv, key, fallback = null) {
  try {
    if (!kv) throw new Error("KV binding is missing");
    const val = await kv.get(key);
    if (!val) return fallback;
    try {
      return JSON.parse(val);
    } catch {
      return fallback;
    }
  } catch (e) {
    console.error("[kvGetJSON]", key, e?.message || e);
    return fallback;
  }
}

/**
 * Записати JSON у KV.
 * @param {KVNamespace} kv - binding (напр. env.STATE_KV)
 * @param {string} key
 * @param {any} value - буде серіалізовано в JSON
 * @param {number} [ttlSeconds] - необов’язковий TTL (секунди)
 * @returns {Promise<boolean>}
 */
export async function kvPutJSON(kv, key, value, ttlSeconds = undefined) {
  try {
    if (!kv) throw new Error("KV binding is missing");
    const str = JSON.stringify(value);
    if (ttlSeconds) {
      await kv.put(key, str, { expirationTtl: ttlSeconds });
    } else {
      await kv.put(key, str);
    }
    return true;
  } catch (e) {
    console.error("[kvPutJSON]", key, e?.message || e);
    return false;
  }
}