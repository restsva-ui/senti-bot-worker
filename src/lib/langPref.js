// src/lib/langPref.js
// Збереження/отримання мови користувача в KV (chat-scoped).

function pickKV(env) {
  return env.STATE_KV || env.CHECKLIST_KV || env.ENERGY_LOG_KV || env.LEARN_QUEUE_KV || null;
}

function keyForChat(chatId) {
  return `prefs:lang:${chatId}`;
}

/**
 * Зчитати мову користувача: спочатку з KV, якщо нема — з Telegram language_code,
 * якщо і це відсутнє — "uk".
 */
export async function getUserLang(env, chatId, tgLanguageCode) {
  const kv = pickKV(env);
  if (kv) {
    try {
      const val = await kv.get(keyForChat(chatId), "text");
      if (val) return val;
    } catch {}
  }
  const lc = String(tgLanguageCode || "").toLowerCase();
  if (lc) return lc;
  return "uk";
}

/** Зберегти мову користувача у KV (best-effort). */
export async function setUserLang(env, chatId, langCode) {
  const kv = pickKV(env);
  if (!kv) return;
  try {
    await kv.put(keyForChat(chatId), String(langCode || "uk").toLowerCase(), { expirationTtl: 60 * 60 * 24 * 180 }); // 180 днів
  } catch {}
}
