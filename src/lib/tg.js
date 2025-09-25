// src/lib/tg.js
// Універсальні хелпери для Telegram Bot API (Cloudflare Workers)

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/** Побудова базового URL до Bot API */
function apiUrl(env, method) {
  const base = (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
  return `${base}/bot${env.BOT_TOKEN}/${method}`;
}

/**
 * Базовий виклик API з детальним логуванням помилок.
 */
export async function tg(env, method, body) {
  try {
    const res = await fetch(apiUrl(env, method), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // Пробуємо прочитати помилку від Telegram, щоб зрозуміти причину (401, 400 тощо)
      let errorText = "";
      try { errorText = await res.text(); } catch {}
      console.error(
        "[TG API ERROR]",
        JSON.stringify({ method, status: res.status, body, errorText })
      );
    }
    return res;
  } catch (e) {
    console.error("[TG API FETCH FAILED]", method, e?.stack || e);
    throw e;
  }
}

/** Найпоширеніші методи як зручні обгортки */
export async function sendMessage(env, body) {
  return tg(env, "sendMessage", body);
}

export async function answerCallbackQuery(env, body) {
  return tg(env, "answerCallbackQuery", body);
}

export async function editMessageText(env, body) {
  // { chat_id, message_id, text, reply_markup } або { inline_message_id, text, ... }
  return tg(env, "editMessageText", body);
}

/** Додаткові корисні (можуть згодитись далі) */
export async function sendPhoto(env, body) {
  return tg(env, "sendPhoto", body);
}

export async function sendDocument(env, body) {
  return tg(env, "sendDocument", body);
}

export default {
  tg,
  sendMessage,
  answerCallbackQuery,
  editMessageText,
  sendPhoto,
  sendDocument,
};