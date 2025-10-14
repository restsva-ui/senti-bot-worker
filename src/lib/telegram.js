// src/lib/telegram.js
// Telegram API helpers with safe error logging

export const TG_API_BASE = "https://api.telegram.org";

export const sendTelegram = async (env, method, payload = {}) => {
  const token = env.TELEGRAM_SECRET_TOKEN || env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token) throw new Error("Missing Telegram token");

  const url = `${TG_API_BASE}/bot${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let data = {};
  try {
    data = await res.json();
  } catch (err) {
    console.error("TG parse fail", err);
  }

  if (!res.ok) {
    const body = JSON.stringify(data);
    throw new Error(`TG ${method} HTTP ${res.status}: ${body}`);
  }
  if (!data.ok) {
    throw new Error(`TG ${method} API error: ${data.description || JSON.stringify(data)}`);
  }

  return data.result;
};

// sendMessage без parse_mode за замовчуванням
export const sendMessage = (env, chat_id, text, extra = {}) =>
  sendTelegram(env, "sendMessage", {
    chat_id,
    text,
    ...(extra.parse_mode ? { parse_mode: extra.parse_mode } : {}),
    ...extra,
  });

export const sendPhoto = (env, chat_id, photo, extra = {}) =>
  sendTelegram(env, "sendPhoto", {
    chat_id,
    photo,
    ...(extra.caption ? { caption: extra.caption } : {}),
    ...(extra.parse_mode ? { parse_mode: extra.parse_mode } : {}),
  });

export const answerCallbackQuery = (env, callback_query_id, text = "", extra = {}) =>
  sendTelegram(env, "answerCallbackQuery", {
    callback_query_id,
    text,
    show_alert: false,
    ...extra,
  });
