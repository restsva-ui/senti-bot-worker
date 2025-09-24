// src/adapters/telegram.js

const BASE = "https://api.telegram.org";

/**
 * Виклик до Telegram API
 */
async function tgCall(env, method, params) {
  const url = `${BASE}/bot${env.TELEGRAM_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`TG API error: ${method} ${JSON.stringify(data)}`);
  }
  return data.result;
}

/**
 * Надіслати повідомлення
 */
export async function tgSendMessage(env, chat_id, text, extra = {}) {
  return tgCall(env, "sendMessage", { chat_id, text, ...extra });
}

/**
 * Надіслати action (наприклад, "typing")
 */
export async function tgSendAction(env, chat_id, action = "typing") {
  return tgCall(env, "sendChatAction", { chat_id, action });
}

/**
 * Отримати URL для файлу
 */
export async function tgGetFileUrl(env, file_id) {
  const file = await tgCall(env, "getFile", { file_id });
  return `${BASE}/file/bot${env.TELEGRAM_TOKEN}/${file.file_path}`;
}