// src/lib/tg.js
// Універсальні хелпери для Telegram Bot API (Cloudflare Workers)

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/** Побудова базового URL до Bot API */
function apiUrl(env, method) {
  const base = (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
  return `${base}/bot${env.BOT_TOKEN}/${method}`;
}

/**
 * Базовий виклик API: tg(env, "sendMessage", {...})
 * Зручно, коли потрібен будь-який метод без окремої обгортки.
 */
export async function tg(env, method, body) {
  return fetch(apiUrl(env, method), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** Найпоширеніші методи як зручні обгортки */
export async function sendMessage(env, body) {
  return tg(env, "sendMessage", body);
}

export async function answerCallbackQuery(env, body) {
  return tg(env, "answerCallbackQuery", body);
}

export async function editMessageText(env, body) {
  // приклади body:
  // { chat_id, message_id, text, parse_mode, reply_markup }
  // або { inline_message_id, text, ... }
  return tg(env, "editMessageText", body);
}

/** Додаткові корисні (можуть згодитись далі) */
export async function sendPhoto(env, body) {
  return tg(env, "sendPhoto", body);
}

export async function sendDocument(env, body) {
  return tg(env, "sendDocument", body);
}

/** На випадок імпорту за замовчуванням */
export default {
  tg,
  sendMessage,
  answerCallbackQuery,
  editMessageText,
  sendPhoto,
  sendDocument,
};